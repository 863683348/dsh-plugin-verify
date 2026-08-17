# Release checklist

1. Write plugin code (lib + cordis.patch.yml + package.json with dsh.bundle).
2. Verify: node --check lib/*.js; node test/*.test.mjs (main-module mode); dump-config shows the plugin row.
3. Publish npm: pwsh scripts/publish-npm.ps1.
4. Add dsh-plugin topic to the GitHub repo.
5. awesome PR: data/plugins/<owner>__<repo>.yml + generate-readme.mjs; meet 1-day / 10-commit bar.
