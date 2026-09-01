// Extends app.json. Everything static lives there; this file only layers in
// the values that differ per build.
//
// EXPO_BASE_URL sets the sub-path the web build is served from. GitHub Pages
// serves this repo at /Claude/, so the Pages build passes /Claude/dayflow.
// Left unset (local dev, Expo Go, native builds) nothing changes.
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_BASE_URL;
  if (!baseUrl) return config;

  return {
    ...config,
    experiments: { ...config.experiments, baseUrl },
  };
};
