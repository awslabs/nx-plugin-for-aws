module.exports = {
  upgrade: true,
  target: (name, semver) => {
    // Check if semver array exists and has elements
    if (semver && semver.length > 0 && semver[0]) {
      const currentVersion = semver[0];
      // Check if current version has pre-release tag
      if (currentVersion.release) {
        return 'latest'; // Upgrade pre-release to latest pre-release
      }
    }
    return 'minor'; // Upgrade stable to latest minor
  },
  // agent-chat-cli 0.4.x depends on @a2a-js/sdk 1.x, which speaks A2A protocol
  // v1 (`SendStreamingMessage`). The vended A2A server SDK (@a2a-js/sdk in
  // versions.ts) is 0.3.x and rejects that with "Method not found", so hold the
  // CLI until the server SDK moves to 1.x, then remove this entry.
  reject: ['agent-chat-cli'],
  packageFile: '{package.json,packages/**/package.json}',
  cooldown: 1, // Only latest versions published for at least 1 day are updated to
  dep: ['prod', 'dev', 'optional', 'packageManager', 'peer'],
};
