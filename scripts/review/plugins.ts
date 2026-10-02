import { join } from "node:path";

/** An upstream Oxlint JavaScript plugin this package can load for a profile. */
export type PluginSource = {
  repository: string;
  /** Rule implementations under this prefix belong to the plugin. */
  rulePath: string;
  /** Vendored entry relative to the repository root, or the npm package that exports the plugin. */
  module: string;
  vendored: boolean;
  /** The build writes `dist/plugins/<file>.js`: a bundle when vendored, a re-export otherwise. */
  file: string;
};

export const PLUGIN_SOURCES: PluginSource[] = [
  {
    repository: "rayhanadev/oxray",
    rulePath: "src/rules/",
    module: "@rayhanadev/ox",
    vendored: false,
    file: "rayhanadev",
  },
  {
    repository: "dmmulroy/anti-slop",
    rulePath: "src/effect/rules/",
    module: "vendor/dmmulroy-anti-slop/src/effect/index.ts",
    vendored: true,
    file: "anti-slop-effect",
  },
  {
    repository: "dmmulroy/anti-slop",
    rulePath: "src/rules/",
    module: "vendor/dmmulroy-anti-slop/src/index.ts",
    vendored: true,
    file: "anti-slop",
  },
];

/**
 * The `jsPlugins` entry in a generated config. Oxlint resolves a package name from the
 * consumer's project, which misses this package's own dependencies under isolated installs, so
 * every plugin loads by a path relative to `oxlint/configs/`.
 */
export function pluginSpecifier(source: PluginSource): string {
  return `../../dist/plugins/${source.file}.js`;
}

/** A loaded plugin: its rule ID prefix and the rules it actually registers. */
export type LoadedPlugin = { source: PluginSource; name: string; rules: Set<string> };

type PluginModule = { default: { meta: { name: string }; rules: { [name: string]: unknown } } };

export async function loadPlugins(root: string): Promise<LoadedPlugin[]> {
  return Promise.all(
    PLUGIN_SOURCES.map(async (source) => {
      const specifier = source.vendored ? join(root, source.module) : source.module;
      const plugin = ((await import(specifier)) as PluginModule).default;
      return { source, name: plugin.meta.name, rules: new Set(Object.keys(plugin.rules)) };
    }),
  );
}

/** Finds the loaded plugin that registers the rule implemented at `path` in `repository`. */
export function findPlugin(
  plugins: LoadedPlugin[],
  repository: string,
  path: string,
  ruleName: string,
): LoadedPlugin | undefined {
  return plugins.find(
    ({ source, rules }) =>
      source.repository === repository && path.startsWith(source.rulePath) && rules.has(ruleName),
  );
}
