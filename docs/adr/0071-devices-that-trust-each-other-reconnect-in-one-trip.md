# 0071. Devices that trust each other reconnect in one trip

> **Status:** Accepted · **Date:** 2026-11-27

## Context

A phone or a browser reaches its member's computer over an encrypted channel
through the relay ([relay.md](../tech/relay.md), "Frames"). Every channel
was opened the way pairing opens one: each end commits to its identity key
and a fresh salt, reveals them, runs Noise XX, then sends its AES-256-GCM
sending key and waits for the other's before anything else moves. The
computer then said `secureReady`, and the device waited for that too. Each
step is a trip phone → relay → computer or back. On a phone in China
reaching a computer in China through a relay abroad, one such trip is
hundreds of milliseconds, and opening a channel took four to five of them
before the first call could leave.

Then the PIN: it was asked "whenever a channel is authorized", so every new
channel asked for it again, and a channel is new after every dropped socket.
A phone switching from Wi-Fi to mobile data, or coming back from the
background, reconnected, renegotiated all of the above and showed the PIN
gate, though its member had typed the PIN a minute earlier.

The commitments exist for pairing: there the two devices compare an
eight-digit safety code drawn from the handshake transcript, and committing
first stops a malicious relay from grinding the code toward a match. Once
both ends have pinned each other's keys, no code is compared. Noise XX
already authenticates both static keys against what each end pinned, and its
ephemeral keys make every channel fresh.

## Decision

- **A channel between devices that already trust each other is `pinned`**
  (`pinned` in `SecureChannel`, `src/secure-channel.ts` in the plugin and in
  `packages/relay-client`, byte for byte). It sends no commitment and no
  reveal. Its first packet is Noise's first message, and a computer that
  receives one (`kind: 'noise'`) for a pairing it does not trust answers
  nothing. The prologue is the fixed domain, `pinned`, the pairing, the
  channel and both pinned keys, so a pinned transcript can never be taken
  for a pairing one. Pairing keeps commit, reveal and the safety code
  unchanged, and a pinned channel refuses a commitment.
- **Each end may send as soon as its own sending key is set**, at either
  kind of channel. It no longer waits for the peer's key: the peer is
  authenticated once Noise completes, and records that reach it before its
  own key import wait in its bounded queue, as they could before. The
  bootstrap deadline (20 seconds) still holds until the peer's key arrives.
- **A device that trusts its computer sends its first call with Noise's last
  message**, not after `secureReady`. The computer decides whether that
  device is still unlocked before it sends `secureReady`, and holds the
  device's work until it has decided, so nothing that arrives early is
  refused as locked.
- **An unlock belongs to the pairing, not to the channel.** The computer
  remembers, in memory, when each pairing last carried work while unlocked. A
  new channel within fifteen minutes of that is unlocked at once; past it,
  the PIN is asked. A wrong PIN, five wrong PINs, revocation, the owner
  changing or resetting the PIN, signing out and changing server each forget
  it. A dropped relay socket does not.

## Consequences

- Reopening a channel costs one round trip, Noise's first two messages, and
  the first call's answer comes back on the second, where it took five or
  more. A reconnect within fifteen minutes shows no PIN gate.
- An attacker who gets a phone that was unlocked less than fifteen minutes
  ago can use it without the PIN, after a reconnect as before it. The PIN
  remains a second lock on a device that already proved its key, as it was;
  this widens nothing beyond the idle limit that already applied to a
  channel that stayed open.
- The relay sees a different first packet (`noise` rather than `commit`) and
  so learns whether a channel is a pairing or a reconnect. It could already
  tell from the timing and from the pairing's status.
- The wire changes for the plugin, the web console and the app together. A
  device without the pinned path still opens with a commitment, which the
  computer still accepts; a computer without it ignores a pinned device, which
  times out and reports the computer unavailable until both are updated.
- Ruled out: Noise IK, which would let the first message carry data, because
  the vetted `@chainsafe/libp2p-noise` implements XX only and a second
  handshake implementation is a larger risk than one trip; and deriving the
  AES keys from Noise's own cipher state, which the library does not expose.
