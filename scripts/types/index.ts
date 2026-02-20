export interface Category {
  id: string;
  title: string;
  description: string;
}

export interface GalleryConfig {
  categories: Category[];
}

export interface LanguageRequirement {
  requires: string;
}

export interface ExtensionEnvironment {
  python?: LanguageRequirement;
  r?: LanguageRequirement;
  quarto?: LanguageRequirement;
}

export interface ExtensionManifest {
  extension: {
    name: string;
    title: string;
    description: string;
    homepage: string;
    version: string;
    minimumConnectVersion: string;
    requiredFeatures?: string[];
    category?: Category["id"];
    tags?: string[];
  };
  environment?: ExtensionEnvironment;
}

export interface ExtensionVersion {
  version: string;
  released: string;
  url: string;
  minimumConnectVersion: string;
  requiredFeatures?: string[];
  requiredEnvironment?: ExtensionEnvironment;
}

export interface Extension {
  name: string;
  title: string;
  description: string;
  homepage: string;
  latestVersion: ExtensionVersion;
  versions: ExtensionVersion[];
  tags: string[];
  category?: Category["id"];
}

export interface GitHubReleaseAsset {
  name: string;
  url: string;
}

export interface GitHubRelease {
  tagName: string;
  publishedAt: string;
  assets: GitHubReleaseAsset[];
  body: string;
}

export interface ReleaseMetadata {
  minimumConnectVersion: string;
  requiredFeatures: string[];
  requiredEnvironment: ExtensionEnvironment;
}

/** Shape returned by the GitHub REST API for a release. */
export interface GitHubApiRelease {
  tag_name: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
  body: string;
}
