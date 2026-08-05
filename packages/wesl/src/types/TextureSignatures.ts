import {
  f32Type,
  i32Type,
  type ScalarType,
  type TextureType,
  type Type,
  u32Type,
  unknownType,
  vecType,
  voidType,
} from "./Types.ts";

/** Return type of a texture builtin. Not table driven: the result depends on
 * the texture argument's own type (depth vs color, channel format). */
export function textureFnType(name: string, argTypes: Type[]): Type {
  const texture = argTypes.find((t): t is TextureType => t.kind === "texture");
  const depth = texture?.name.startsWith("texture_depth") ?? false;

  switch (name) {
    case "textureDimensions":
      return texture ? textureDimensionsType(texture) : unknownType;
    case "textureNumLayers":
    case "textureNumLevels":
    case "textureNumSamples":
      return u32Type;
    case "textureLoad":
      if (!texture) return unknownType;
      if (depth) return f32Type;
      return vecType(4, textureChannelType(texture));
    case "textureGather":
      if (!texture) return unknownType;
      return vecType(4, depth ? f32Type : (texture.sampled ?? f32Type));
    case "textureGatherCompare":
      return vecType(4, f32Type);
    case "textureSample":
    case "textureSampleLevel":
      // without the texture type we can't tell depth (f32) from color (vec4)
      if (!texture) return unknownType;
      return depth ? f32Type : vecType(4, f32Type);
    case "textureSampleBias":
    case "textureSampleGrad":
    case "textureSampleBaseClampToEdge":
      return vecType(4, f32Type);
    case "textureSampleCompare":
    case "textureSampleCompareLevel":
      return f32Type;
    case "textureStore":
    case "textureBarrier":
      return voidType;
    default:
      return unknownType;
  }
}

/** textureDimensions results: one size per texture dimension. */
function textureDimensionsType(texture: TextureType): Type {
  const { name } = texture;
  if (name.endsWith("_1d")) return u32Type;
  if (name.endsWith("_3d")) return vecType(3, u32Type);
  return vecType(2, u32Type);
}

/** Sampled/storage channel scalar for textureLoad results. */
function textureChannelType(texture: TextureType): ScalarType {
  if (texture.sampled) return texture.sampled;
  const format = texture.format ?? "";
  if (format.endsWith("uint")) return u32Type;
  if (format.endsWith("sint")) return i32Type;
  return f32Type;
}
