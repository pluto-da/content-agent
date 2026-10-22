/** 0.6.0 起 Schema 校验移到前后端共用模块 @content-agent/shared（本机模式与服务端同一份实现）。 */
export { charLen, weightedLen, validate, stripExtensions, stableStringify, type JsonSchema, type SchemaError } from '@content-agent/shared';
