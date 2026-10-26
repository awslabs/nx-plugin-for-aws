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
  reject: [
    'agent-chat-cli',
    // Biome 2.6 turns on Markdown and YAML formatting by default. The vended
    // `format` target (`biome format {projectRoot}`) then fails on generated
    // README.md and YAML files, and `build` depends on it. js-api 6.1.0
    // requires @biomejs/wasm-nodejs ^2.6.0, so all three are held together.
    // Lift once a fix(ts#project) PR ships Biome 2.6 with the Markdown/YAML
    // formatter (and the Markdown linter, if it is on by default) turned off
    // in vended biome.json, plus a latest/ migration.
    '@biomejs/biome',
    '@biomejs/wasm-nodejs',
    '@biomejs/js-api',
  ],
  packageFile: '{package.json,packages/**/package.json}',
  cooldown: 1, // Only latest versions published for at least 1 day are updated to
  dep: ['prod', 'dev', 'optional', 'packageManager', 'peer'],
};
