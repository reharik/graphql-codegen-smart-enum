# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.4] - 2026-04-26

### Added

- **`@enumMeta(props: …)`** — the plugin parses `props: [EnumMetaPropInput!]` (each entry `{ name, value }` as strings) and emits each pair as a string field on the generated smart-enum member. An enum value that only sets `props` (no `display` / `shortDisplay` / `description` / `sortOrder`) is still treated as having `@enumMeta`, so object input and metadata are generated (including `display` fallbacks as for other `enumMeta` values).

## [0.2.3] and earlier

- **`skipEnums` config** — optional `string[]` of GraphQL enum type names to omit from the generated file. Use when certain schema enums should be handled only by the TypeScript plugin (or outside this plugin).

Releases **v0.1.2** and **v0.1.3** predate this changelog; see the repository history for those changes.
