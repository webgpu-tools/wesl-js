// From https://www.w3.org/TR/WGSL/#predeclared
// Use https://github.com/webgpu-tools/wgsl-spec to regenerate these list in the future

// Names outside core WGSL live in their own list, one per extension, which the
// std lists below interpolate. Each list names the directive that enables it.
//
// We still accept every name unconditionally: wesl doesn't check a use against
// the directives in scope, leaving that to naga/tint. So the split is for
// readers, and for deciding which builtins deserve type signatures.
//
// Only extensions that add *names* appear here. Most add an attribute, an
// enumerant, or a behavior instead (dual_source_blending,
// pointer_composite_access), and WebGPU device features are a separate axis
// again - see texelFormats.

/** `enable subgroups`: the subgroup and quad operations. */
export const subgroupFns = `
  subgroupAdd subgroupAll subgroupAnd subgroupAny subgroupBallot
  subgroupBroadcast subgroupBroadcastFirst subgroupElect
  subgroupExclusiveAdd subgroupExclusiveMul subgroupInclusiveAdd
  subgroupInclusiveMul subgroupMax subgroupMin subgroupMul subgroupOr
  subgroupShuffle subgroupShuffleDown subgroupShuffleUp subgroupShuffleXor
  subgroupXor
  quadBroadcast quadSwapDiagonal quadSwapX quadSwapY`;

/** `enable atomic_vec2u_min_max` (stores, so they return no value). */
export const atomicMinMaxFns = `atomicStoreMin atomicStoreMax`;

/** `requires packed_4x8_integer_dot_product` - a language extension, so it
 * comes in through requires rather than enable. */
export const packed4x8Fns = `
  dot4U8Packed dot4I8Packed
  pack4xI8 pack4xU8 pack4xI8Clamp pack4xU8Clamp
  unpack4xI8 unpack4xU8`;

export const stdFns = names(`bitcast all any select arrayLength
  abs acos acosh asin asinh atan atanh atan2 ceil clamp cos cosh
  countLeadingZeros countOneBits countTrailingZeros cross
  degrees determinant distance dot
  exp exp2 extractBits faceForward firstLeadingBit firstTrailingBit
  floor fma fract frexp insertBits inverseSqrt ldexp length log log2
  max min mix modf normalize pow quantizeToF16 radians reflect refract
  reverseBits round saturate sign sin sinh smoothstep sqrt step tan tanh
  transpose trunc
  dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine fwidth
  fwidthCoarse fwidthFine
  textureDimensions textureGather textureGatherCompare textureLoad
  textureNumLayers textureNumLevels textureNumSamples
  textureSample textureSampleBias textureSampleCompare textureSampleCompareLevel
  textureSampleGrad textureSampleLevel textureSampleBaseClampToEdge
  textureStore
  atomicLoad atomicStore atomicAdd atomicSub atomicMax atomicMin
  atomicAnd atomicOr atomicXor atomicExchange atomicCompareExchangeWeak
  pack4x8snorm pack4x8unorm
  pack2x16snorm pack2x16unorm pack2x16float
  unpack4x8snorm unpack4x8unorm
  unpack2x16snorm unpack2x16unorm unpack2x16float
  storageBarrier textureBarrier workgroupBarrier workgroupUniformLoad
  ${subgroupFns}
  ${atomicMinMaxFns}
  ${packed4x8Fns}`);

export const sampledTextureTypes = `
  texture_1d texture_2d texture_2d_array texture_3d 
  texture_cube texture_cube_array
`;

export const multisampledTextureTypes = `
  texture_multisampled_2d texture_depth_multisampled_2d
`;

export const textureStorageTypes = `
  texture_storage_1d texture_storage_2d texture_storage_2d_array 
  texture_storage_3d
`;

/**
 * Storage texel formats. The second group is available only with a WebGPU
 * feature (texture-formats-tier1, and the norm16 formats); wesl accepts them
 * unconditionally rather than tracking which features a shader enabled.
 */
export const texelFormats = `
  rgba8unorm rgba8snorm rgba8uint rgba8sint
  rgba16uint rgba16sint rgba16float
  r32uint r32sint r32float rg32uint rg32sint rg32float
  rgba32uint rgba32sint rgba32float
  bgra8unorm
  r8unorm r8snorm r8uint r8sint
  r16unorm r16snorm r16uint r16sint r16float
  rg8unorm rg8snorm rg8uint rg8sint
  rg16unorm rg16snorm rg16uint rg16sint rg16float
  rgb10a2uint rgb10a2unorm rg11b10ufloat
  rgba16unorm rgba16snorm
`;

/** `enable f16`: the scalar, and the vector/matrix aliases spelled with it
 * (vec2h is vec2<f16>, mat2x2h is mat2x2<f16>). */
export const f16Types = `f16
  mat2x2h mat2x3h mat2x4h mat3x2h mat3x3h mat3x4h
  mat4x2h mat4x3h mat4x4h
  vec2h vec3h vec4h`;

export const stdTypes = names(`array atomic bool f32 i32
  mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
  mat2x2f mat2x3f mat2x4f mat3x2f mat3x3f mat3x4f
  mat4x2f mat4x3f mat4x4f
  u32 vec2 vec3 vec4 ptr
  vec2i vec3i vec4i vec2u vec3u vec4u
  vec2f vec3f vec4f
  ${f16Types}
  ${sampledTextureTypes}
  ${multisampledTextureTypes}
  texture_external
  ${textureStorageTypes}
  texture_depth_2d texture_depth_2d_array texture_depth_cube
  texture_depth_cube_array
  sampler sampler_comparison
  ${texelFormats}`);

/** https://www.w3.org/TR/WGSL/#predeclared-enumerants  */
export const stdEnumerants = names(`read write read_write
  function private workgroup uniform storage
  ${texelFormats}`);

/* Note the texel formats like rgba8unorm are also in stdTypes because they appear
 in type position in <templates> for texture_storage_* types.
 (We could parse texture_storage types specially, but user code is unlikely to alias
  the texture format names with e.g. a 'struct rbga8unorm .)
*/

/** WGSL standard attributes whose params need binding (e.g., @workgroup_size).
 * See: https://www.w3.org/TR/WGSL/#attributes */
export const wgslStandardAttributes = new Set([
  "align",
  "binding",
  "blend_src",
  "compute",
  "const",
  "fragment",
  "group",
  "id",
  "invariant",
  "location",
  "must_use",
  "size",
  "vertex",
  "workgroup_size",
]);

// membership Sets: these queries run per otherwise-unresolved ident during
// binding, where a linear scan of the name lists would be wasteful.
// stdWgslSet is the union, so the "any builtin?" test costs one lookup.
const stdTypeSet = new Set(stdTypes);
const stdFnSet = new Set(stdFns);
const stdEnumerantSet = new Set(stdEnumerants);
const stdWgslSet = new Set([...stdTypes, ...stdFns, ...stdEnumerants]);

/** return true if the name is for a built in type (not a user struct) */
export function stdType(name: string): boolean {
  return stdTypeSet.has(name);
}

/** return true if the name is for a built in fn (not a user function) */
export function stdFn(name: string): boolean {
  return stdFnSet.has(name) || stdTypeSet.has(name);
}

/** return true if the name is for a built in enumerant */
export function stdEnumerant(name: string): boolean {
  return stdEnumerantSet.has(name);
}

/** @return true if ident is a standard WGSL type, fn, or enumerant. */
export function stdWgsl(name: string): boolean {
  return stdWgslSet.has(name); // TODO add tests for enumerants case (e.g. var x = read;)
}

/** The names in a whitespace-separated list. */
function names(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}
