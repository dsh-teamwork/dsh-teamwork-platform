package team

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Network is where a provider may be called from this server (ADR 0006). A
// team admin, not the operator, names a provider's address, so on a shared
// instance an address is a way to make this server call its own network:
//
//	| Scheme | ALLOW_PRIVATE_PROVIDERS unset | set                   |
//	| https  | every address public          | any address           |
//	| http   | never                         | every address private |
//
// Private means loopback, the private ranges, link-local (cloud metadata
// lives there), carrier-grade NAT and the unspecified address. The rule is
// checked when an address is saved, before every call, and on the socket
// itself: the dialer refuses the address it is about to connect to, so an
// answer that changed since the check (DNS rebinding) is never connected to.
type Network struct {
	AllowPrivate bool
	// Lookup resolves a host; net.DefaultResolver when nil.
	Lookup func(ctx context.Context, host string) ([]netip.Addr, error)
}

var private = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
}

// IsPrivate is whether an address is one a shared instance must not call.
func IsPrivate(a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range private {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// Allowed is whether address may be called over scheme ("https" or "http").
func (n *Network) Allowed(a netip.Addr, scheme string) bool {
	switch scheme {
	case "https":
		return n.AllowPrivate || !IsPrivate(a)
	case "http":
		return n.AllowPrivate && IsPrivate(a)
	}
	return false
}

func refused() error { return wire.E(http.StatusBadRequest, wire.ProviderAddressRefused) }

// Check is provider_address_refused unless every address the host resolves
// to may be called.
func (n *Network) Check(ctx context.Context, u *url.URL) error {
	host := strings.Trim(u.Hostname(), "[]")
	var addrs []netip.Addr
	if a, err := netip.ParseAddr(host); err == nil {
		addrs = []netip.Addr{a}
	} else {
		lookup := n.Lookup
		if lookup == nil {
			lookup = func(ctx context.Context, h string) ([]netip.Addr, error) {
				return net.DefaultResolver.LookupNetIP(ctx, "ip", h)
			}
		}
		if addrs, err = lookup(ctx, host); err != nil {
			return refused()
		}
	}
	if len(addrs) == 0 {
		return refused()
	}
	for _, a := range addrs {
		if !n.Allowed(a, u.Scheme) {
			return refused()
		}
	}
	return nil
}

// Client is the HTTP client for provider calls: no proxy from the
// environment, no redirects, and a dialer that refuses any address the rule
// does not allow for the request's scheme.
func (n *Network) Client() *http.Client {
	guarded := func(scheme string) func(ctx context.Context, network, addr string) (net.Conn, error) {
		d := &net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
			Control: func(_, address string, _ syscall.RawConn) error {
				ap, err := netip.ParseAddrPort(address)
				if err != nil || !n.Allowed(ap.Addr(), scheme) {
					return fmt.Errorf("provider address refused: %s", address)
				}
				return nil
			},
		}
		if n.Lookup != nil {
			// Tests resolve hosts themselves; the dialer still checks what it connects to.
			return func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				if _, err := netip.ParseAddr(host); err != nil {
					found, err := n.Lookup(ctx, host)
					if err != nil || len(found) == 0 {
						return nil, fmt.Errorf("lookup %s: %v", host, err)
					}
					addr = net.JoinHostPort(found[0].String(), port)
				}
				return d.DialContext(ctx, network, addr)
			}
		}
		return d.DialContext
	}
	transport := func(scheme string) *http.Transport {
		return &http.Transport{
			Proxy:                 nil,
			DialContext:           guarded(scheme),
			ForceAttemptHTTP2:     true,
			MaxIdleConnsPerHost:   64,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
		}
	}
	bySchemes := schemes{"https": transport("https"), "http": transport("http")}
	return &http.Client{
		Transport:     bySchemes,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// schemes sends a request through the transport whose dialer holds the rule
// for its scheme.
type schemes map[string]*http.Transport

func (s schemes) RoundTrip(r *http.Request) (*http.Response, error) {
	t, ok := s[r.URL.Scheme]
	if !ok {
		return nil, fmt.Errorf("provider address refused: scheme %q", r.URL.Scheme)
	}
	return t.RoundTrip(r)
}
