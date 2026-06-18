/// <reference types="wesl-plugin/suffixes" />
import { expect, expectTypeOf, test } from "vitest";
// @ts-expect-error TS module declarations can't match query-param conditions
import wgsl from "../shaders/foo/app.wesl?MOBILE=true&FUN&SAFE=false&static";

test("verify ?static", async () => {
  expectTypeOf(wgsl).toExtend<string>();

  expect(wgsl).toMatchInlineSnapshot(`
    "

    const start = mobileStart;

    fn main() {
       let a = pcg_2u_3f(start);
    }

    const mobileStart = vec2u(1, 2);

    fn pcg_2u_3f(pos: vec2u) -> vec3f {
        let seed = mix2to3(pos);
        let random = pcg_3u_3u(seed);
        let normalized = ldexp(vec3f(random), vec3(-32));
        return vec3f(normalized);
    }

    fn mix2to3(p: vec2u) -> vec3u {
        let seed = vec3u(p.x, p.x ^ p.y, p.x + p.y);
        return seed;
    }

    fn pcg_3u_3u(seed: vec3u) -> vec3u {
        var v = seed * 1664525u + 1013904223u;

        v = mixing(v);
        v ^= v >> vec3(16u);
        v = mixing(v);

        return v;
    }

    fn mixing(v: vec3u) -> vec3u {
        var m: vec3u = v;
        m.x += v.y * v.z;
        m.y += v.z * v.x;
        m.z += v.x * v.y;

        return m;
    }"
  `);
});
