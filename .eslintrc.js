module.exports = {
  extends: [
    "standard",
    "plugin:prettier/recommended",
    "plugin:node/recommended"
  ],
  globals: {},
  env: {
    mocha: true,
    node: true
  },
  plugins: ["havven", "no-only-tests", "promise"],
  rules: {
    "havven/no-assert-revert-without-await": "error",
    "havven/no-assert-invalid-opcode-without-await": "error",
    "prefer-arrow-callback": "error",
    "prefer-const": "error",
    "no-process-exit": "off",
    "standard/computed-property-even-spacing": "off",
    "no-only-tests/no-only-tests": "error",

    "promise/always-return": "error",
    "promise/no-return-wrap": "error",
    "promise/param-names": "off",
    "promise/catch-or-return": "error",
    "promise/no-native": "off",
    "promise/no-nesting": "warn",
    "promise/no-promise-in-callback": "warn",
    "promise/no-callback-in-promise": "warn",
    "promise/avoid-new": "warn",
    "promise/no-new-statics": "error",
    "promise/no-return-in-finally": "warn",
    "promise/valid-params": "warn"
  }
};
