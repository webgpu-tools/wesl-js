import { test } from "vitest";
import { link } from "../Linker.ts";
import { expectTrimmedMatch } from "./TrimmedMatch.ts";

test("basic @elif chain", async () => {
  const src = `
    @if(false) const a = 1;
    @elif(true) const a = 2;
    @else const a = 3;
    const b = a;
  `;

  const expected = `
    const a = 2;
    const b = a;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif with false condition", async () => {
  const src = `
    @if(false) const a = 1;
    @elif(false) const a = 2;
    @else const a = 3;
    const b = a;
  `;

  const expected = `
    const a = 3;
    const b = a;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("multiple @elif chain", async () => {
  const src = `
    @if(false) const x = 1;
    @elif(false) const x = 2;
    @elif(true) const x = 3;
    @elif(true) const x = 4;
    @else const x = 5;
    const y = x;
  `;

  const expected = `
    const x = 3;
    const y = x;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif without @else", async () => {
  const src = `
    @if(false) const a = 1;
    @elif(false) const a = 2;
    @elif(true) const a = 3;
    const b = a;
  `;

  const expected = `
    const a = 3;
    const b = a;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif on functions", async () => {
  const src = `
    @if(false) fn compute() -> u32 { return 1; }
    @elif(true) fn compute() -> u32 { return 2; }
    @else fn compute() -> u32 { return 3; }
    
    fn main() -> u32 {
      return compute();
    }
  `;

  const expected = `
    fn compute() -> u32 {
      return 2;
    }

    fn main() -> u32 {
      return compute();
    }
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif with complex conditions", async () => {
  const src = `
    @if(foo && bar) const x = 1;
    @elif(!foo || bar) const x = 2;
    @elif(foo && !bar) const x = 3;
    @else const x = 4;
    const y = x;
  `;

  const expected = `
    const x = 3;
    const y = x;
  `;

  const conditions = { foo: true, bar: false };
  const result = await link({
    weslSrc: { app: src },
    rootModuleName: "app",
    conditions,
  });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif on struct members", async () => {
  const src = `
    struct Vertex {
      @if(use_color) color: vec4f,
      @elif(use_uv) uv: vec2f,
      @else dummy: f32,
      position: vec3f,
    }
  `;

  const expected = `
    struct Vertex {
      uv: vec2f,
      position: vec3f,
    }
  `;

  const conditions = { use_color: false, use_uv: true };
  const result = await link({
    weslSrc: { app: src },
    rootModuleName: "app",
    conditions,
  });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif first condition true", async () => {
  const src = `
    @if(true) const x = 1;
    @elif(true) const x = 2;
    @elif(true) const x = 3;
    @else const x = 4;
    const y = x;
  `;

  const expected = `
    const x = 1;
    const y = x;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif with mixed directives", async () => {
  const src = `
    @if(false) const_assert true;
    @elif(true) const_assert false == false;
    @else const_assert 1 == 1;
  `;

  const expected = `
    const_assert false == false;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif all false falls to @else", async () => {
  const src = `
    @if(false) const x = 1;
    @elif(false) const x = 2;
    @elif(false) const x = 3;
    @else const x = 4;
    const y = x;
  `;

  const expected = `
    const x = 4;
    const y = x;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});

test("@elif chain resets after non-conditional", async () => {
  const src = `
    @if(true) const a = 1;
    @elif(true) const a = 2;
    
    const separator = 0;
    
    @if(false) const b = 1;
    @elif(true) const b = 2;
    
    const result = a + b;
  `;

  const expected = `
    const a = 1;
    
    const separator = 0;
    
    const b = 2;
    
    const result = a + b;
  `;

  const result = await link({ weslSrc: { app: src }, rootModuleName: "app" });
  expectTrimmedMatch(result.dest, expected);
});
