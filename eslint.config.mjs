/* -----------------------------------------------------------------------------
 * Undefined identifiers, and nothing else.
 *
 * This exists because of one bug. A variable was declared in the wrong function
 * — the file parsed, `node --check` was happy, and the whole suite passed,
 * because every check on that code read the SOURCE rather than running it. The
 * branch that used the variable was a diagnostic nobody had exercised in a
 * browser, so it threw a ReferenceError the first time somebody pressed the
 * button, silently, and the feature had never once worked.
 *
 * `no-undef` catches exactly that, in every branch, without running anything.
 * The rest of a linter's opinions are deliberately left out: this is a check for
 * a class of fault, not a style guide.
 * -------------------------------------------------------------------------- */

export default [{
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'script',
    globals: {
      // The browser surface these files actually use.
      window: 'readonly', document: 'readonly', localStorage: 'readonly',
      sessionStorage: 'readonly', navigator: 'readonly', location: 'readonly',
      console: 'readonly', getComputedStyle: 'readonly', atob: 'readonly',
      setTimeout: 'readonly', clearTimeout: 'readonly',
      setInterval: 'readonly', clearInterval: 'readonly',
      requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
      WebSocket: 'readonly', TextDecoder: 'readonly', fetch: 'readonly',
      AbortController: 'readonly', Image: 'readonly', FileReader: 'readonly',
      Blob: 'readonly', File: 'readonly', URL: 'readonly',
      createImageBitmap: 'readonly', performance: 'readonly', Intl: 'readonly',
      // And the node surface, for tools/.
      module: 'writable', require: 'readonly', __dirname: 'readonly',
      process: 'readonly', global: 'writable', Buffer: 'readonly'
    }
  },
  rules: { 'no-undef': 'error' }
}];
