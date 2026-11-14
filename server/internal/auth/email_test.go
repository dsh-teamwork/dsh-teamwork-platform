package auth_test

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
)

// received is what one SMTP session delivered.
type received struct {
	from, to string
	data     string
}

// fakeSMTP is just enough of an SMTP server: no STARTTLS, no AUTH. With
// refuseRcpt it answers every RCPT with 550.
func fakeSMTP(t *testing.T, refuseRcpt bool) (string, <-chan received) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	out := make(chan received, 1)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveSMTP(conn, refuseRcpt, out)
		}
	}()
	return "smtp://" + ln.Addr().String(), out
}

func serveSMTP(conn net.Conn, refuseRcpt bool, out chan<- received) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(conn)
	reply := func(s string) { fmt.Fprint(conn, s+"\r\n") }
	var msg received
	reply("220 fake ESMTP")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		verb := strings.ToUpper(strings.SplitN(line, " ", 2)[0])
		switch {
		case verb == "EHLO":
			reply("250-fake")
			reply("250 8BITMIME")
		case verb == "HELO", verb == "RSET", verb == "NOOP":
			reply("250 ok")
		case strings.HasPrefix(strings.ToUpper(line), "MAIL FROM:"):
			msg.from = between(line, "<", ">")
			reply("250 ok")
		case strings.HasPrefix(strings.ToUpper(line), "RCPT TO:"):
			if refuseRcpt {
				reply("550 no such mailbox")
				continue
			}
			msg.to = between(line, "<", ">")
			reply("250 ok")
		case verb == "DATA":
			reply("354 go ahead")
			var b strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				b.WriteString(strings.TrimPrefix(l, "."))
			}
			msg.data = b.String()
			reply("250 queued")
			out <- msg
		case verb == "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 not implemented")
		}
	}
}

func between(s, open, close string) string {
	i, j := strings.Index(s, open), strings.LastIndex(s, close)
	if i < 0 || j <= i {
		return ""
	}
	return s[i+1 : j]
}

func TestSMTPSendsTheCode(t *testing.T) {
	url, got := fakeSMTP(t, false)
	m := auth.SMTP{URL: url, From: "DSH Teamwork <codes@example.test>"}
	if err := m.SendCode(context.Background(), "a@example.test", "123456"); err != nil {
		t.Fatal(err)
	}
	var msg received
	select {
	case msg = <-got:
	case <-time.After(5 * time.Second):
		t.Fatal("no message reached the server")
	}
	if msg.from != "codes@example.test" || msg.to != "a@example.test" {
		t.Fatalf("envelope from %q to %q", msg.from, msg.to)
	}
	parsed, err := mail.ReadMessage(strings.NewReader(msg.data))
	if err != nil {
		t.Fatalf("message: %v\n%s", err, msg.data)
	}
	from, err := mail.ParseAddress(parsed.Header.Get("From"))
	if err != nil || from.Address != "codes@example.test" || from.Name != "DSH Teamwork" {
		t.Errorf("From: %q", parsed.Header.Get("From"))
	}
	if parsed.Header.Get("To") != "a@example.test" {
		t.Errorf("To: %q", parsed.Header.Get("To"))
	}
	if !strings.Contains(parsed.Header.Get("Subject"), "123456") {
		t.Errorf("Subject: %q", parsed.Header.Get("Subject"))
	}
	if !strings.Contains(msg.data[strings.Index(msg.data, "\r\n\r\n"):], "123456") {
		t.Errorf("body holds no code:\n%s", msg.data)
	}
}

// A refused message is an error, and the error never carries the code.
func TestSMTPRefusalIsAnErrorWithoutTheCode(t *testing.T) {
	url, _ := fakeSMTP(t, true)
	err := auth.SMTP{URL: url}.SendCode(context.Background(), "a@example.test", "123456")
	if err == nil {
		t.Fatal("a refused recipient was not an error")
	}
	if strings.Contains(err.Error(), "123456") {
		t.Fatalf("the error carries the code: %v", err)
	}
}
