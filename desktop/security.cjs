const crypto = require("node:crypto");

// RFC 5489 + RFC 7905: authenticated ephemeral ECDH, with a random room PSK.
// Electron's Node/BoringSSL bridge exposes external PSKs for TLS 1.2 only.
// Pin the one AEAD + ECDHE suite; never fall back to plain PSK, CBC, or ws://.
const PSK_IDENTITY = "pibble-room-v3";
const CIPHER = "ECDHE-PSK-CHACHA20-POLY1305";
const TLS_OPTIONS = Object.freeze({
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  ciphers: CIPHER,
  ecdhCurve: "X25519",
  secureOptions:
    crypto.constants.SSL_OP_NO_TICKET |
    crypto.constants.SSL_OP_NO_RENEGOTIATION,
});

function clientTlsOptions(key) {
  return {
    ...TLS_OPTIONS,
    // Certificates are not used: Finished authenticates both peers with the PSK.
    // This is safe only with the PSK-only cipher above; keep rejectUnauthorized.
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
    pskCallback: () => ({ identity: PSK_IDENTITY, psk: key }),
  };
}

function verifyTransport(socket, client = false) {
  if (
    !socket?.encrypted ||
    socket.getProtocol() !== "TLSv1.2" ||
    socket.getCipher()?.name !== CIPHER ||
    socket.isSessionReused()
  )
    throw new Error("Secure transport required");
  if (
    client &&
    (!socket.authorized || socket.getEphemeralKeyInfo()?.name !== "X25519")
  )
    throw new Error("Authenticated ephemeral X25519 required");
  socket.disableRenegotiation();
}

module.exports = {
  PSK_IDENTITY,
  TLS_OPTIONS,
  clientTlsOptions,
  verifyTransport,
};
