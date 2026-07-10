import wgsl_test::expectNear;

@test fn laterPassKeepsFirstFailure() {
  expectNear(1.0, 5.0); // fails; these values should be reported
  expectNear(3.0, 3.0); // passes; must not overwrite the reported values
}
