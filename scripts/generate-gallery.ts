import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { ExtensionManifest, GalleryConfig, GitHubRelease } from "./types";
import {
  buildExtensions,
  buildOutput,
  collectTagsAndFeatures,
  transformGitHubApiReleases,
} from "./generate-gallery-lib";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const extensionsDir = requireEnv("EXTENSIONS_DIR");
const galleryConfigPath = requireEnv("GALLERY_CONFIG");
const outputPath = requireEnv("EXTENSIONS_JSON");
const repo = requireEnv("GITHUB_REPOSITORY");

// 1. Read category config
const config: GalleryConfig = JSON.parse(
  fs.readFileSync(galleryConfigPath, "utf8")
);

// 2. Scan all extension manifests
const extensionDirs = fs
  .readdirSync(extensionsDir)
  .filter((dir) => {
    const manifestPath = path.join(extensionsDir, dir, "manifest.json");
    return (
      fs.statSync(path.join(extensionsDir, dir)).isDirectory() &&
      fs.existsSync(manifestPath)
    );
  });

const manifests = new Map<string, ExtensionManifest>();

for (const dir of extensionDirs) {
  const manifestPath = path.join(extensionsDir, dir, "manifest.json");
  const manifest: ExtensionManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );
  manifests.set(dir, manifest);
}

const { allTags, allFeatures } = collectTagsAndFeatures(manifests);

// 3. Query all GitHub releases via the REST API (gh release list does not
//    expose the assets or body fields, so we call the API directly).
const rawReleases = JSON.parse(
  execSync(`gh api repos/${repo}/releases --paginate`, { encoding: "utf8" })
);
const allReleases: GitHubRelease[] = transformGitHubApiReleases(rawReleases);

// 4. Build extensions array
const extensions = buildExtensions(manifests, allReleases);

// 5. Write output
const output = buildOutput(extensions, config, allTags, allFeatures);

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

console.log(
  `Generated extensions.json with ${extensions.length} extensions and ${extensions.reduce((sum, e) => sum + e.versions.length, 0)} total versions`
);
