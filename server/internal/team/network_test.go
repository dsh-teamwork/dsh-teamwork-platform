package team

import (
	"net/netip"
	"testing"
)

func TestIsPrivate(t *testing.T) {
	for addr, want := range map[string]bool{
		"8.8.8.8": false, "2606:4700::1111": false,
		"127.0.0.1": true, "10.1.2.3": true, "172.16.0.1": true, "192.168.1.1": true,
		"169.254.169.254": true, "100.64.0.1": true, "0.0.0.0": true,
		"::1": true, "::": true, "fd00::1": true, "fe80::1": true,
		"::ffff:169.254.169.254": true, // IPv4-mapped
		"64:ff9b::a9fe:a9fe":     true, // NAT64 of 169.254.169.254
		"64:ff9b:1::1":           true, // local-use NAT64
		"2002:a9fe:a9fe::1":      true, // 6to4 of 169.254.169.254
		"::a9fe:a9fe":            true, // IPv4-compatible
	} {
		if got := IsPrivate(netip.MustParseAddr(addr)); got != want {
			t.Errorf("%s: private %v, want %v", addr, got, want)
		}
	}
}

func TestAllowed(t *testing.T) {
	public, private := netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("10.0.0.1")
	strict, open := &Network{}, &Network{AllowPrivate: true}
	cases := []struct {
		n      *Network
		a      netip.Addr
		scheme string
		want   bool
	}{
		{strict, public, "https", true}, {strict, private, "https", false}, {strict, public, "http", false}, {strict, private, "http", false},
		{open, public, "https", true}, {open, private, "https", true}, {open, private, "http", true}, {open, public, "http", false},
		{open, private, "ftp", false},
	}
	for _, c := range cases {
		if got := c.n.Allowed(c.a, c.scheme); got != c.want {
			t.Errorf("allowPrivate=%v %s %s: %v, want %v", c.n.AllowPrivate, c.scheme, c.a, got, c.want)
		}
	}
}
