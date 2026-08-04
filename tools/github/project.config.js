/**
 * Board configuration for tools/github/*.js scripts.
 *
 * The Cribstop Platform Backlog is a user-level board (github.com/users/jmbilizi/projects/7),
 * so `owner` is the GitHub user that owns it, not necessarily anything org-related — Projects v2
 * permissions for a user-owned board are granted per-user.
 *
 * Override via env vars (e.g. if this ever moves to an org-owned board) so nothing here needs to
 * change per-environment.
 */
module.exports = {
  owner: process.env.GH_PROJECT_OWNER || 'jmbilizi',
  repo: process.env.GH_PROJECT_REPO || 'real-estate-platform',
  projectNumber: process.env.GH_PROJECT_NUMBER ? Number(process.env.GH_PROJECT_NUMBER) : 7,
};
