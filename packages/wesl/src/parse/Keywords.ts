// Use https://github.com/webgpu-tools/wgsl-spec to check this list in the future
// I recommend checking whether a new list and the current list are equal

/** https://www.w3.org/TR/WGSL/#keyword-summary */
export const keywords =
  `alias break case const const_assert continue continuing 
  default diagnostic discard else enable false fn for if 
  let loop override requires return struct switch true var while`.split(/\s+/);

/** https://www.w3.org/TR/WGSL/#reserved-words */
export const reservedWords =
  `NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await
  become cast catch class co_await co_return co_yield coherent column_major
  common compile compile_fragment concept const_cast consteval constexpr constinit crate
  debugger decltype delete demote demote_to_helper do dynamic_cast
  enum explicit export extends extern external fallthrough filter final finally friend from fxgroup
  get goto groupshared highp impl implements import inline instanceof interface layout lowp
  macro macro_rules match mediump meta mod module move mut mutable
  namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr
  of operator package packoffset partition pass patch pixelfragment precise precision premerge
  priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict
  self set shared sizeof smooth snorm static static_assert static_cast std subroutine super
  target template this thread_local throw trait try type typedef typeid typename typeof
  union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield`.split(
    /\s+/,
  );

/** words that can't be used as identifiers */
export const keywordOrReserved = new Set(keywords.concat(reservedWords));
