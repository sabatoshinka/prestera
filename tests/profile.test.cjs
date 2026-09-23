const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("Peer profile fields are bounded, unsafe URLs and unknown decorations are rejected", async () => {
  const { profileData, safeBanner } = await import("../src/profile-data.js");
  const p = profileData({
    name: "a".repeat(500),
    bio: "b".repeat(5000),
    statusText: "x".repeat(500),
    presence: "__proto__",
    frame: "../external",
    profileColor: "url(https://external)",
    avatar: "https://external/a.png",
  });
  assert.equal(p.name.length, 32);
  assert.equal(p.bio.length, 600);
  assert.equal(p.statusText.length, 100);
  assert.equal(p.presence, "online");
  assert.equal(p.frame, "none");
  assert.equal(p.avatar, "");
  assert.equal(p.profileColor, "#8773ab");
  assert.equal(safeBanner("data:image/svg+xml;base64,YQ=="), "");
  assert.equal(safeBanner("data:image/webp;base64," + "a".repeat(60000)), "");
  const maxProfile = profileData({
    avatar: "data:image/webp;base64," + "a".repeat(47970),
    bio: "я".repeat(600),
    statusText: "я".repeat(100),
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify({ type: "profile", ...maxProfile })) <
      65536,
  );
});
test("Event cues are short PCM audio with quiet boundaries and no clipping", () => {
  const files = fs.readdirSync("public/events");
  assert.equal(files.length, 11);
  for (const file of files) {
    const b = fs.readFileSync("public/events/" + file);
    assert.equal(b.toString("ascii", 0, 4), "RIFF");
    assert.equal(b.readUInt32LE(24), 48000);
    const length = (b.length - 44) / 2;
    assert.ok(length > 4000 && length < 24000);
    assert.equal(b.readInt16LE(44), 0);
    assert.equal(b.readInt16LE(b.length - 2), 0);
    let peak = 0;
    for (let i = 44; i < b.length; i += 2)
      peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
    assert.ok(peak > 1000 && peak < 20000, `${file}: unsafe peak ${peak}`);
  }
});
