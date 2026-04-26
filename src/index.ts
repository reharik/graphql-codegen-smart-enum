import type { PluginFunction } from "@graphql-codegen/plugin-helpers";
import {
  Kind,
  isEnumType,
  type DirectiveNode,
  type GraphQLEnumType,
  type GraphQLEnumValue,
  type GraphQLSchema,
} from "graphql";

export interface SmartEnumPluginConfig {
  enumClassSuffix?: string;
  emitDescriptionsAsDisplay?: boolean;
  /** GraphQL enum type names to exclude from generated output. */
  skipEnums?: string[];
}

const DEFAULT_ENUM_CLASS_SUFFIX = "";
const ENUM_META_DIRECTIVE_NAME = "enumMeta";

const escapeString = (value: string): string => {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
};

type ParsedEnumValueMeta = {
  display?: string;
  shortDisplay?: string;
  description?: string;
  sortOrder?: number;
  /** Key/value pairs from `@enumMeta(props: ...)`; later entries win on duplicate `name`. */
  props?: readonly { name: string; value: string }[];
};

const isValidJsIdentifier = (name: string): boolean => {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
};

const formatObjectFieldKey = (name: string): string => {
  return isValidJsIdentifier(name) ? name : `'${escapeString(name)}'`;
};

const toLowerCamelCase = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
};

const toCamelCase = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .toLowerCase();
  const parts = normalized.split(" ").filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  const [first, ...rest] = parts;
  return [
    first,
    ...rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`),
  ].join("");
};

const deriveDisplayFromEnumKey = (enumKey: string): string => {
  return enumKey
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

const getEnumValueDirective = (
  enumValue: GraphQLEnumValue,
  directiveName: string,
): DirectiveNode | undefined => {
  return enumValue.astNode?.directives?.find(
    (directive) => directive.name.value === directiveName,
  );
};

const parseStringDirectiveArg = (
  directive: DirectiveNode,
  argName: string,
): string | undefined => {
  const argValue = directive.arguments?.find(
    (argument) => argument.name.value === argName,
  )?.value;

  return argValue?.kind === Kind.STRING ? argValue.value : undefined;
};

const parseIntDirectiveArg = (
  directive: DirectiveNode,
  argName: string,
): number | undefined => {
  const argValue = directive.arguments?.find(
    (argument) => argument.name.value === argName,
  )?.value;

  if (argValue?.kind !== Kind.INT) {
    return undefined;
  }

  const parsed = Number.parseInt(argValue.value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseEnumMetaProps = (
  directive: DirectiveNode,
): readonly { name: string; value: string }[] | undefined => {
  const argValue = directive.arguments?.find(
    (argument) => argument.name.value === "props",
  )?.value;

  if (argValue?.kind !== Kind.LIST) {
    return undefined;
  }

  const result: { name: string; value: string }[] = [];

  for (const item of argValue.values) {
    if (item.kind !== Kind.OBJECT) {
      continue;
    }

    const nameNode = item.fields.find((f) => f.name.value === "name")?.value;
    const valueNode = item.fields.find((f) => f.name.value === "value")?.value;

    if (nameNode?.kind !== Kind.STRING || valueNode?.kind !== Kind.STRING) {
      continue;
    }

    result.push({ name: nameNode.value, value: valueNode.value });
  }

  return result.length > 0 ? result : undefined;
};

const parseEnumMetaDirective = (
  enumValue: GraphQLEnumValue,
): ParsedEnumValueMeta | undefined => {
  const enumMetaDirective = getEnumValueDirective(enumValue, ENUM_META_DIRECTIVE_NAME);
  if (!enumMetaDirective) {
    return undefined;
  }

  const props = parseEnumMetaProps(enumMetaDirective);
  const parsedMeta: ParsedEnumValueMeta = {
    display: parseStringDirectiveArg(enumMetaDirective, "display"),
    shortDisplay: parseStringDirectiveArg(enumMetaDirective, "shortDisplay"),
    description: parseStringDirectiveArg(enumMetaDirective, "description"),
    sortOrder: parseIntDirectiveArg(enumMetaDirective, "sortOrder"),
    ...(typeof props !== "undefined" ? { props } : {}),
  };

  if (
    typeof parsedMeta.display === "undefined" &&
    typeof parsedMeta.shortDisplay === "undefined" &&
    typeof parsedMeta.description === "undefined" &&
    typeof parsedMeta.sortOrder === "undefined" &&
    (typeof props === "undefined" || props.length === 0)
  ) {
    return undefined;
  }

  return parsedMeta;
};

const getTrimmedEnumValueDescription = (
  enumValue: GraphQLEnumValue,
): string | undefined => {
  const description = enumValue.description?.trim();
  return typeof description === "string" && description.length > 0
    ? description
    : undefined;
};

const resolveEnumValueDisplay = (
  enumValue: GraphQLEnumValue,
  parsedMeta?: ParsedEnumValueMeta,
): string => {
  if (typeof parsedMeta?.display === "string") {
    return parsedMeta.display;
  }

  const valueDescription = getTrimmedEnumValueDescription(enumValue);
  if (typeof valueDescription === "string") {
    return valueDescription;
  }

  return deriveDisplayFromEnumKey(enumValue.name);
};

const resolveEnumValueDescription = (
  enumValue: GraphQLEnumValue,
  parsedMeta?: ParsedEnumValueMeta,
): string | undefined => {
  if (typeof parsedMeta?.description === "string") {
    return parsedMeta.description;
  }

  return getTrimmedEnumValueDescription(enumValue);
};

const quoteLiteral = (value: unknown): string => {
  if (typeof value === "string") {
    return `'${escapeString(value)}'`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  return `'${escapeString(String(value))}'`;
};

const isNonIntrospectionEnumType = (
  type: ReturnType<GraphQLSchema["getTypeMap"]>[string],
): type is GraphQLEnumType => {
  return isEnumType(type) && !type.name.startsWith("__");
};

const getEnumTypes = (schema: GraphQLSchema): readonly GraphQLEnumType[] => {
  return Object.values(schema.getTypeMap())
    .filter(isNonIntrospectionEnumType)
    .sort((left, right) => left.name.localeCompare(right.name));
};

const filterSkippedEnumTypes = (
  enumTypes: readonly GraphQLEnumType[],
  skipEnums: string[] | undefined,
): readonly GraphQLEnumType[] => {
  if (typeof skipEnums === "undefined" || skipEnums.length === 0) {
    return enumTypes;
  }

  const skip = new Set(skipEnums);
  return enumTypes.filter((enumType) => !skip.has(enumType.name));
};

const validateConfig = (config: SmartEnumPluginConfig): void => {
  if (
    typeof config.enumClassSuffix !== "undefined" &&
    typeof config.enumClassSuffix !== "string"
  ) {
    throw new Error(
      "[graphql-codegen-smart-enum] Config `enumClassSuffix` must be a string when provided.",
    );
  }

  if (
    typeof config.emitDescriptionsAsDisplay !== "undefined" &&
    typeof config.emitDescriptionsAsDisplay !== "boolean"
  ) {
    throw new Error(
      "[graphql-codegen-smart-enum] Config `emitDescriptionsAsDisplay` must be a boolean when provided.",
    );
  }

  if (typeof config.skipEnums !== "undefined") {
    if (!Array.isArray(config.skipEnums)) {
      throw new Error(
        "[graphql-codegen-smart-enum] Config `skipEnums` must be an array of strings when provided.",
      );
    }

    for (const name of config.skipEnums) {
      if (typeof name !== "string") {
        throw new Error(
          "[graphql-codegen-smart-enum] Config `skipEnums` must contain only string enum type names.",
        );
      }
    }
  }
};

const assertNoCamelCaseCollisions = (
  enumName: string,
  originalValues: readonly string[],
): void => {
  const byCamelCase = new Map<string, string[]>();

  for (const originalValue of originalValues) {
    const camelCasedValue = toCamelCase(originalValue);
    const existing = byCamelCase.get(camelCasedValue) ?? [];
    byCamelCase.set(camelCasedValue, [...existing, originalValue]);
  }

  const collisions = [...byCamelCase.entries()].filter(
    ([, values]) => values.length > 1,
  );

  if (collisions.length === 0) {
    return;
  }

  const details = collisions
    .map(
      ([camelKey, values]) =>
        `"${camelKey}" <- [${values.map((value) => `"${value}"`).join(", ")}]`,
    )
    .join("; ");
  throw new Error(
    `[graphql-codegen-smart-enum] CamelCase collision in enum "${enumName}". Conflicting values: ${details}.`,
  );
};

const buildEnumBlock = (
  enumName: string,
  enumType: GraphQLEnumType,
  enumClassSuffix: string,
  emitDescriptionsAsDisplay: boolean,
): { inputLine: string; typeLine: string; enumLine: string } => {
  const generatedName = `${enumName}${enumClassSuffix}`;
  const { inputDefinition, inputName } = buildInput(
    generatedName,
    enumType,
    emitDescriptionsAsDisplay,
  );

  return {
    inputLine: inputDefinition,
    typeLine: `export type ${generatedName} = Enumeration<typeof ${generatedName}>;`,
    enumLine: `export const ${generatedName} = enumeration<typeof ${inputName}>('${escapeString(enumName)}', { input: ${inputName} });`,
  };
};

export const plugin: PluginFunction<SmartEnumPluginConfig> = (
  schema,
  _documents,
  config,
): string => {
  validateConfig(config);

  const enumClassSuffix = config.enumClassSuffix ?? DEFAULT_ENUM_CLASS_SUFFIX;
  const emitDescriptionsAsDisplay = config.emitDescriptionsAsDisplay ?? true;

  const enumTypes = filterSkippedEnumTypes(
    getEnumTypes(schema),
    config.skipEnums,
  );

  if (enumTypes.length === 0) {
    return "";
  }

  const blocks = enumTypes.map((enumType) =>
    buildEnumBlock(
      enumType.name,
      enumType,
      enumClassSuffix,
      emitDescriptionsAsDisplay,
    ),
  );
  const inputLines = blocks.map((block) => block.inputLine);
  const typeLines = blocks.map((block) => block.typeLine);
  const enumLines = blocks.map((block) => block.enumLine);

  return [
    "/**",
    " * -----------------------------------------------------------------------------",
    " * THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.",
    " * Any manual changes will be overwritten by GraphQL Code Generator.",
    " * -----------------------------------------------------------------------------",
    " */",
    "",
    "import { enumeration, type Enumeration } from '@reharik/smart-enum';",
    "",
    ...inputLines,
    "",
    ...typeLines,
    "",
    ...enumLines,
    "",
  ].join("\n");
};

const buildInput = (
  generatedName: string,
  enumType: GraphQLEnumType,
  emitDescriptionsAsDisplay: boolean,
): { inputDefinition: string; inputName: string } => {
  const inputName = `${toLowerCamelCase(generatedName)}Input`;
  const enumValues = enumType.getValues();
  const originalEnumValues = enumValues.map((enumValue) => enumValue.name);
  assertNoCamelCaseCollisions(enumType.name, originalEnumValues);
  const hasDescriptions = enumValues.some(
    (enumValue) =>
      typeof enumValue.description === "string" &&
      enumValue.description.trim().length > 0,
  );
  const hasDeprecatedValues = enumValues.some(
    (enumValue) => typeof enumValue.deprecationReason === "string",
  );
  const hasEnumMeta = enumValues.some(
    (enumValue) => typeof parseEnumMetaDirective(enumValue) !== "undefined",
  );
  const shouldUseObjectInput =
    hasDeprecatedValues || hasEnumMeta || (emitDescriptionsAsDisplay && hasDescriptions);

  const inputDefinition = shouldUseObjectInput
    ? `const ${inputName} = { ${enumValues
        .map((enumValue) => {
          const parsedMeta = parseEnumMetaDirective(enumValue);
          const resolvedDisplay = resolveEnumValueDisplay(enumValue, parsedMeta);
          const resolvedDescription = resolveEnumValueDescription(
            enumValue,
            parsedMeta,
          );
          const objectFields: string[] = [];
          const entryKey = toCamelCase(enumValue.name);
          const hasParsedMeta = typeof parsedMeta !== "undefined";

          if (emitDescriptionsAsDisplay || hasParsedMeta) {
            objectFields.push(`display: '${escapeString(resolvedDisplay)}'`);
          }

          if (typeof parsedMeta?.shortDisplay === "string") {
            objectFields.push(
              `shortDisplay: '${escapeString(parsedMeta.shortDisplay)}'`,
            );
          }

          if (hasParsedMeta && typeof resolvedDescription === "string") {
            objectFields.push(`description: '${escapeString(resolvedDescription)}'`);
          }

          if (typeof parsedMeta?.sortOrder === "number") {
            objectFields.push(`sortOrder: ${parsedMeta.sortOrder}`);
          }

          if (typeof parsedMeta?.props !== "undefined") {
            const propByName = new Map<string, string>();
            for (const { name, value } of parsedMeta.props) {
              propByName.set(name, value);
            }
            for (const [propName, propValue] of propByName) {
              objectFields.push(
                `${formatObjectFieldKey(propName)}: ${quoteLiteral(propValue)}`,
              );
            }
          }

          if (typeof enumValue.deprecationReason === "string") {
            objectFields.push("deprecated: true");
            objectFields.push(
              `deprecationReason: '${escapeString(enumValue.deprecationReason)}'`,
            );
          }

          return `${quoteLiteral(entryKey)}: { ${objectFields.join(", ")} }`;
        })
        .join(", ")} } as const;`
    : `const ${inputName} = [${enumValues
        .map((enumValue) => quoteLiteral(toCamelCase(enumValue.name)))
        .join(", ")}] as const;`;
  return { inputDefinition, inputName };
};
