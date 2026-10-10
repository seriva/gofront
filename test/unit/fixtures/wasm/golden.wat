  (func $f (export "Vec.Dot") (export "Vec_Dot") (type $t) (param (ref null $t) (ref null $t)) (result f64)
    local.get 0
    struct.get $t 0
    local.get 1
    struct.get $t 0
    f64.mul
    local.get 0
    struct.get $t 1
    local.get 1
    struct.get $t 1
    f64.mul
    f64.add
    return
  )
  (func $f (export "Add") (type $t) (param i64 i64) (result i64)
    local.get 0
    local.get 1
    i64.add
    return
  )
  (func $f (export "Sum") (type $t) (param (ref null $t)) (result i64)
    (local i64 (ref null $t) i32 i32 (ref null $t) i32 i64)
    i64.const 0
    local.set 1
    local.get 0
    local.tee 5
    struct.get $t 0
    local.set 2
    local.get 5
    struct.get $t 1
    local.set 3
    local.get 5
    struct.get $t 2
    local.set 4
    i32.const 0
    local.set 6
    block
    loop
    local.get 6
    local.get 4
    i32.ge_s
    br_if 1
    block
    local.get 2
    local.get 3
    local.get 6
    i32.add
    array.get $t
    local.set 7
    local.get 1
    local.get 7
    i64.add
    local.set 1
    end
    local.get 6
    i32.const 1
    i32.add
    local.set 6
    br 0
    end
    end
    local.get 1
    return
  )
  (func $f (export "Main") (type $t) (result f64)
    (local (ref null $t) (ref null $t))
    f64.const 1
    f64.const 2
    struct.new $t
    local.tee 0
    local.tee 1
    struct.get $t 0
    local.get 1
    struct.get $t 1
    struct.new $t
    f64.const 3
    f64.const 4
    struct.new $t
    call N
    i64.const 1
    i64.const 2
    call N
    f64.convert_i64_s
    f64.add
    i64.const 1
    i64.const 2
    i64.const 3
    array.new_fixed $t 3
    i32.const 0
    i32.const 3
    i32.const 3
    struct.new $t
    call N
    f64.convert_i64_s
    f64.add
    return
  )
