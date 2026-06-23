
@compute @workgroup_size(1) fn main() {
  let a = b + pcg_2u_3f(vec2u(1, 3)).x;
}

const b = 7.1;

// PCG pseudo random generator from vec2u to vec3f
// the random output is in the range from zero to 1
fn pcg_2u_3f(pos: vec2u) -> vec3f {
  let seed = mix2to3(pos);
  let random = pcg_3u_3u(seed);
  let normalized = ldexp(vec3f(random), vec3(-32));
  return vec3f(normalized);
}

// mix position into a seed as per: https://www.shadertoy.com/view/XlGcRh
fn mix2to3(p: vec2u) -> vec3u {
  let seed = vec3u(p.x, p.x ^ p.y, p.x + p.y);
  return seed;
}

// PCG random generator from vec3u to vec3u
// adapted from http://www.jcgt.org/published/0009/03/02/
fn pcg_3u_3u(seed: vec3u) -> vec3u {
  var v = seed * 1664525u + 1013904223u;
  v = mixing(v);
  v ^= v >> vec3(16u);
  v = mixing(v);
  return v;
}

// permuted lcg 
fn mixing(v: vec3u) -> vec3u {
  var m: vec3u = v;
  m.x += v.y * v.z;
  m.y += v.z * v.x;
  m.z += v.x * v.y;
  return m;
}
