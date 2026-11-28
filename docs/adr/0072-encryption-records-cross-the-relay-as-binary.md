# 0072. Encryption records cross the relay as binary

> **Status:** Accepted · **Date:** 2026-11-27

## Context

Everything between a phone or a browser and its member's computer is an
encryption record: a commitment, a reveal, a Noise message or AES-GCM
ciphertext ([relay.md](../tech/relay.md), "Frames"). Each went through the
relay as a JSON text frame, `{ t: 'sealed', pairingId, channelId, kind, data }`,
with the record base64-encoded in `data`. Base64 adds a third to every byte,
the relay parsed and re-marshalled up to 700,000 characters of it per frame,
and each end encoded and decoded it in JavaScript, the phone's on Hermes. The
relay never reads the record; it needs only the pairing id to route it.

## Decision

- **A record is one binary WebSocket message**: its kind in one byte
  (1 commit, 2 reveal, 3 noise, 4 data), the pairing id's length in one byte,
  the pairing id, the 22-character channel id, then the record's bytes as
  they are, at most 512 KiB. `encodePacket` and `decodePacket` in
  `secure-channel.ts` (the plugin's and `packages/relay-client`'s, byte for
  byte) write and read it; `parseSealed` in `server/relay/protocol.go` reads
  the header.
- **The relay passes the message on unchanged**: it checks the header, routes
  by the pairing id and queues the same bytes for the other socket. It no
  longer parses or re-encodes a record.
- **Everything else stays JSON text**: hellos, `ping`/`pong`, routing
  refusals, `presence`, the plugin's requests. A `sealed` text frame is
  ignored.

## Consequences

- A record costs its own size plus a header of under 100 bytes, a quarter
  less on the wire than before, and no base64 at either end or JSON at the
  relay. A follow's 256 KiB snapshot crosses as about 256 KiB.
- Every end changes together: the relay, the plugin, the web console and the
  app. A device or a computer that still sends `sealed` as text reaches
  nobody until it is updated.
- React Native still turns binary into base64 on its way to the native
  socket, out of our code; the bytes on the wire are binary all the same.
- Ruled out: WebSocket compression, which would gain nothing on ciphertext,
  and a framing of our own inside one long-lived binary stream, which would
  move message boundaries out of the WebSocket for no gain.
