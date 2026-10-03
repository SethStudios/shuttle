// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/*', 'scripts/*'],
  },
  {
    files: ['utils/supabase.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
