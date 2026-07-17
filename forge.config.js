const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const macSigningIdentity = process.env.ORION_MAC_SIGN_IDENTITY
  || 'Developer ID Application: R&R Unicorns, LLC (KV46DBU287)';
const macEntitlements = path.join(__dirname, 'build', 'entitlements.mac.plist');
const macNonCodeResourcePattern = /\.(?:pak|bin|dat|png|jpe?g|gif|icns|ico|ttf|woff2?)$/i;

module.exports = {
  packagerConfig: {
    // node-pty's spawn-helper is a plain executable (no .node extension), so
    // the auto-unpack-natives plugin alone won't unpack it — unpack the whole
    // module. The plugin merges its own '**/*.node' pattern into this.
    asar: { unpack: '**/node_modules/node-pty/**' },
    icon: path.join(__dirname, 'assets', 'icon'),
    extraResource: [path.join(__dirname, 'assets', 'icon.png')],
    name: 'Orion',
    appBundleId: 'com.complexia.orion',
    appCategoryType: 'public.app-category.developer-tools',
    extendInfo: {
      NSAppleEventsUsageDescription:
        'Orion uses Apple Events so agents can control Mac apps on your behalf.',
    },
    osxSign: {
      identity: macSigningIdentity,
      hardenedRuntime: true,
      entitlements: macEntitlements,
      ignore: (filePath) => macNonCodeResourcePattern.test(filePath),
    },
  },
  rebuildConfig: {},
  hooks: {
    // The Vite plugin packages only the `.vite` bundle (everything else is
    // ignored), so runtime externals must be copied into the app manually.
    // node-pty stays external (native module) — copy it and restore the
    // exec bit on its spawn-helper, which npm strips from prebuilds.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const fs = require('node:fs');
      const src = path.join(__dirname, 'node_modules', 'node-pty');
      const dest = path.join(buildPath, 'node_modules', 'node-pty');
      fs.cpSync(src, dest, { recursive: true, dereference: true });
      const prebuilds = path.join(dest, 'prebuilds');
      if (fs.existsSync(prebuilds)) {
        for (const dir of fs.readdirSync(prebuilds)) {
          const helper = path.join(prebuilds, dir, 'spawn-helper');
          if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
        }
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        background: path.join(__dirname, 'assets', 'dmg-background.png'),
        contents: (opts) => [
          {
            x: 337,
            y: 166,
            type: 'link',
            path: '/Applications',
          },
          {
            x: 142,
            y: 166,
            type: 'file',
            path: opts.appPath,
          },
        ],
        icon: path.join(__dirname, 'assets', 'icon.icns'),
        iconSize: 80,
        title: 'Orion Installer',
        format: 'ULFO',
        additionalDMGOptions: {
          window: {
            size: {
              width: 480,
              height: 313,
            },
          },
        },
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
