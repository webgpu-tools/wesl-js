import env::u;

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let timeOffset = u32(u.time * 60.0);
  let seed = vec2u(pos.xy) + timeOffset;
  let rand = random_wgsl::lib::pcg_2u_3f(seed);
  return vec4(rand, 1.0);
}