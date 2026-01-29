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
  reject: ['@hey-api/openapi-ts'],
  packageFile: '{package.json,packages/**/package.json}',
  cooldown: 5, // Only latest versions published for 5 days are updated to
  dep: ['prod', 'dev', 'optional', 'packageManager', 'peer'],
};
