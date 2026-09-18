/**
 * Conventional Commits, enforced so the changelog can be generated from history
 * rather than written by hand (npm run changelog).
 *
 * Only commits introduced by a pull request are checked. Linting all history
 * would fail on the repository's own initial commit, which cannot be rewritten
 * without breaking every issue link that already points at it.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    /* Commit bodies here carry reasoning, and reflowing prose to satisfy a
       linter makes it worse to read. Subjects stay short; bodies are free. */
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
  },
};
