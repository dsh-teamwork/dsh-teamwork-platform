package auth

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

// Mailer sends a sign-in code. SMTP is the one transport: the hosted service
// points SMTP_URL at Resend's SMTP endpoint, a self-hosted instance at
// whatever mail server it has.
type Mailer interface {
	SendCode(ctx context.Context, to, code string) error
}

// SMTP sends over SMTP_URL: smtps:// for TLS from the start (465), smtp://
// for STARTTLS where the server offers it (587).
type SMTP struct {
	URL  string
	From string // AUTH_EMAIL_FROM; "DSH Teamwork <no-reply@localhost>" when empty
}

// SendCode sends the code. The code is never logged: a code in a log is a
// code anybody with log access can use, so an error carries the server's
// reply, never the message.
func (m SMTP) SendCode(ctx context.Context, to, code string) error {
	u, err := url.Parse(m.URL)
	if err != nil || (u.Scheme != "smtp" && u.Scheme != "smtps") || u.Hostname() == "" {
		return errors.New("SMTP_URL: smtp://user:password@host:587 or smtps://…:465")
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"smtp": "587", "smtps": "465"}[u.Scheme]
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	addr := net.JoinHostPort(u.Hostname(), port)
	tlsConfig := &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12}
	var conn net.Conn
	if u.Scheme == "smtps" {
		conn, err = (&tls.Dialer{Config: tlsConfig}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok {
		conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, u.Hostname())
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if u.Scheme == "smtp" {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsConfig); err != nil {
				return err
			}
		}
	}
	if u.User != nil {
		pass, _ := u.User.Password()
		if err := c.Auth(smtp.PlainAuth("", u.User.Username(), pass, u.Hostname())); err != nil {
			return err
		}
	}
	from := m.From
	if from == "" {
		from = "DSH Teamwork <no-reply@localhost>"
	}
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return fmt.Errorf("AUTH_EMAIL_FROM: %w", err)
	}
	if err := c.Mail(sender.Address); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	id := make([]byte, 12)
	rand.Read(id)
	domain := sender.Address[strings.LastIndex(sender.Address, "@")+1:]
	msg := strings.Join([]string{
		"From: " + sender.String(),
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", "Your sign-in code: "+code),
		"Date: " + time.Now().UTC().Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Your sign-in code is " + code + ". It expires in 10 minutes.",
		"",
		"If you did not ask for it, ignore this email.",
		"",
	}, "\r\n")
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
