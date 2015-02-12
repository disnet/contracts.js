var should = require("should"), assert = require("assert");
import @ from "contracts.js";

macro blame {
    case {_ of { $body ... } should be $message } => {
        letstx $expectedMsg = [makeValue(#{$message}[0].token.value.raw, #{here})];
        return #{
            try {
                $body ...
                assert.fail("no exception", "exception", "Should have blamed: " + $expectedMsg);
            } catch (b) {
                (b.message).should.equal($expectedMsg);
            }
        }
    }
}


describe("contracts", function() {
    it("should blame the context when called wrong", function() {
        @ (Num) -> Num
        function numId(x) { return x; }

        blame of {
            numId('foo');
        } should be `numId: contract violation
expected: Num
given: 'foo'
in: the 1st argument of
    (Num) -> Num
function numId guarded at line: 22
blaming: (calling context for numId)
`
    });

    it("should blame function when it goes wrong", function() {
        @ (Num) -> Num
        function numId(x) { return "foo"; }

        blame of {
            numId(42);
        } should be `numId: contract violation
expected: Num
given: 'foo'
in: the return of
    (Num) -> Num
function numId guarded at line: 38
blaming: function numId
`
    });

    it("should blame the correct argument in a multiple argument function", function() {
        @ (Num, Str) -> Num
        function f(x, y) { return x; }

        blame of {
            f(42, 42);
        } should be `f: contract violation
expected: Str
given: 42
in: the 2nd argument of
    (Num, Str) -> Num
function f guarded at line: 54
blaming: (calling context for f)
`
    });

    it("should not blame when optional arguments are omitted", function() {
        @ (Num, ?Str) -> Num
        function f(x, s) {
            return x;
        }

        (f(100)).should.equal(100);
    });

    it("should blame when optional arguments are wrong", function() {
        @ (Num, ?Str) -> Num
        function f(x, s) {
            return x;
        }

        blame of {
            f(100, 100);
        } should be `f: contract violation
expected: Str
given: 100
in: the 2nd argument of
    (Num, ?Str) -> Num
function f guarded at line: 79
blaming: (calling context for f)
`
    });

    it("should blame when not given a function for a function contract", function() {
        @((Num) -> Num) -> Num
        function f(g) { return g(42); }

        blame of {
            f(42);
        } should be `f: contract violation
expected: a function that takes 1 argument
given: 42
in: the 1st argument of
    ((Num) -> Num) -> Num
function f guarded at line: 97
blaming: (calling context for f)
`
    });

    it("should correctly blame context in the higher-order case", function() {
        @ ((Num) -> Num) -> Num
        function numApp(f) {
            return f(42);
        }

        blame of {
            numApp(function(x) {
                return "string";
            });
        } should be `numApp: contract violation
expected: Num
given: 'string'
in: the return of
    the 1st argument of
    ((Num) -> Num) -> Num
function numApp guarded at line: 113
blaming: (calling context for numApp)
`
    });

    it("should correctly blame the function in the higher-order case", function() {
        @ ((Num) -> Num) -> Num
        function bad(f) {
            return f("string");
        }

        blame of {
            bad(function(x) { return x; });
        } should be `bad: contract violation
expected: Num
given: 'string'
in: the 1st argument of
    the 1st argument of
    ((Num) -> Num) -> Num
function bad guarded at line: 134
blaming: function bad
`
    });

    it("should blame the context for object contracts", function() {
        @ ({age: Num}) -> Num
        function f(o) { return o.age; }

         blame of {
            f({age: "foo"});
         } should be `f: contract violation
expected: Num
given: 'foo'
in: the age property of
    the 1st argument of
    ({age: Num}) -> Num
function f guarded at line: 153
blaming: (calling context for f)
`
    });

    it("should blame the context for functions in an object contract", function() {
        @ ({g: (Num) -> Num}) -> Num
        function f(o) {
            return o.g(42);
        }

        blame of {
            f({g: function(x) {return "string";}});
        } should be `f: contract violation
expected: Num
given: 'string'
in: the return of
    the g property of
    the 1st argument of
    ({g: (Num) -> Num}) -> Num
function f guarded at line: 170
blaming: (calling context for f)
`
    });

    it("should blame the context when not given an object", function() {
        @ ({s: Str}) -> Str
        function f(o) { return o.s; }

        blame of {
            f(42);
        } should be `f: contract violation
expected: an object with at least 1 key
given: 42
in: the 1st argument of
    ({s: Str}) -> Str
function f guarded at line: 190
blaming: (calling context for f)
`
    });

    it("should allow optional contracts on an object", function() {
        @ ({foo: ?Str}) -> Str
        function f(o) { return "str"; }

        (f({bar: 42})).should.equal("str");
    });

    it("should blame when an optional contract is violated for an object", function() {
        @ ({foo: ?Str}) -> Str
        function f(o) { return "str"; }

        blame of {
            f({foo: 42});
        } should be `f: contract violation
expected: Str
given: 42
in: the foo property of
    the 1st argument of
    ({foo: ?Str}) -> Str
function f guarded at line: 213
blaming: (calling context for f)
`
    });

    it("should blame a proxied object after it has been created", function() {
        @ (Num) -> !{age: Num}
        function makePerson(age) {
            return {age: age};
        }

        blame of {
            var p = makePerson(42);
            p.age = "string";
        } should be `makePerson: contract violation
expected: Num
given: 'string'
in: setting the age property of
    the return of
    (Num) -> !{age: Num}
function makePerson guarded at line: 230
blaming: (calling context for makePerson)
`
    });

    it("should blame the function when it uses a proxied object wrong", function() {
        @ (!{age: Num}) -> Num
        function f(o) {
            o.age = "42";
            return o.age;
        }

        blame of {
            f({age: 42});
        } should be `f: contract violation
expected: Num
given: '42'
in: setting the age property of
    the 1st argument of
    (!{age: Num}) -> Num
function f guarded at line: 250
blaming: function f
`
    });

    it("should blame an array with the wrong field", function() {
        @ ([Str]) -> Num
        function f(arr) { return arr[0]; }

        blame of {
            f([1]);
        } should be `f: contract violation
expected: Str
given: 1
in: the 0th field of
    the 1st argument of
    ([Str]) -> Num
function f guarded at line: 270
blaming: (calling context for f)
`
    });

    it("should blame an array with missing fields", function() {
        @ ([Str, Num]) -> Num
        function f(arr) { return arr[0]; }

        blame of {
            f(["string"]);
        } should be `f: contract violation
expected: Num
given: undefined
in: the 1st field of
    the 1st argument of
    ([Str, Num]) -> Num
function f guarded at line: 287
blaming: (calling context for f)
`
    });

    it("should blame a proxied array", function() {
        @ (Num) -> ![Num]
        function makeArr(n) { return [n]; }

        blame of {
            var a = makeArr(42);
            a[0] = "string";
        } should be `makeArr: contract violation
expected: Num
given: 'string'
in: the 0th field of
    the return of
    (Num) -> ![Num]
function makeArr guarded at line: 304
blaming: (calling context for makeArr)
`
    });

    it("should blame an var length array", function() {
        @ ([...Num]) -> Num
        function f(arr) { return 42; }

        blame of {
            f([42, 100, 60000, "foo"]);
        } should be `f: contract violation
expected: Num
given: 'foo'
in: the 3rd field of
    the 1st argument of
    ([....Num]) -> Num
function f guarded at line: 322
blaming: (calling context for f)
`
    });

    it("should not blame an empty var length array", function() {
        @ ([...Num]) -> Num
        function f(arr) { return 42; }

        (f([])).should.equal(42);
    });

    it("should blame a var length array with the repeat that comes first", function() {
        @ ([...Num, Str]) -> Str
        function f(arr) { return "str"; }

        blame of {
            f([100, 1000, "str"]);
        } should be `The repeated contract must come last in [....Num, Str]`
    });

    it("should blame a proxied var length array", function() {
        @ (![...Num]) -> Num
        function f(arr) {
            arr[100] = "string";
            return 42;
        }

        blame of {
            f([42]);
        } should be `f: contract violation
expected: Num
given: 'string'
in: the 100th field of
    the 1st argument of
    (![....Num]) -> Num
function f guarded at line: 355
blaming: function f
`
    });

    it("should allow objects of objects contracts", function() {
        @ ({o : {name: Str}}) -> Str
        function f(obj) { return obj.o.name; }

        blame of {
            f({o: {name: 42}});
        } should be `f: contract violation
expected: Str
given: 42
in: the name property of
    the o property of
    the 1st argument of
    ({o: {name: Str}}) -> Str
function f guarded at line: 375
blaming: (calling context for f)
`
    });

    it("should work with the loc example", function() {
        @ ({name: Str}, [...{loc: Num}]) -> Str
        function calcAverageLoc(person, locArr) {
            var sum = locArr.reduce(function (l1, l2) {
                return l1.loc + l2.loc;
            });
            return "Average lines of code for " +
                person.name + " was " +
                sum / locArr.length;
        }

        var typoPerson = {nam: "Bob"};
        blame of {
            calcAverageLoc(typoPerson, [{loc: 1000}, {loc: 789}, {loc: 9001}]);
        } should be `calcAverageLoc: contract violation
expected: Str
given: undefined
in: the name property of
    the 1st argument of
    ({name: Str}, [....{loc: Num}]) -> Str
function calcAverageLoc guarded at line: 393
blaming: (calling context for calcAverageLoc)
`
    });

    it("should bind contracts to names", function() {
        @ let NumId = (Num) -> Num

        @ (NumId) -> Num
        function f(g) { return g(100); }

        (f(function(x) { return x; })).should.equal(100);
        blame of {
            f(function(x) { return "string"; })
        } should be `f: contract violation
expected: Num
given: 'string'
in: the return of
    the 1st argument of
    ((Num) -> Num) -> Num
function f guarded at line: 420
blaming: (calling context for f)
`

    });

    it("should work with or contracts", function() {
        @ (Str or Num) -> Str
        function foo(s) { return s.toString(); }

        (foo("foo")).should.equal("foo");
        (foo(42)).should.equal("42");
        blame of {
            (foo(false))
        } should be `foo: contract violation
expected: Str or Num
given: false
in: the 1st argument of
    (Str or Num) -> Str
function foo guarded at line: 439
blaming: (calling context for foo)
`
    });

    it("should work for dependent contracts", function() {
        @ (x: Pos) -> res: Num | res <= x
        function bad_square_root(x) { return x * x; }

        blame of {
            bad_square_root(100)
        } should be `bad_square_root: contract violation
expected: res <= x
given: false
in: the return dependency of
    (x: Pos) -> res: Num | res <= x
function bad_square_root guarded at line: 457
blaming: function bad_square_root
`
    });

    it("should blame the contract if the dependency breaks a domain contract", function() {
        @ (f: (Num) -> Num) -> res: Num | { return f("foo") > 10 }
        function foo(f) { return f(24) }

        blame of {
            foo(function(x) {
                return x;
            });
        } should be `foo: contract violation
expected: Num
given: 'foo'
in: the 1st argument of
    the 1st argument of
    (f: (Num) -> Num) -> res: Num | return f (foo) > 10
function foo guarded at line: 473
blaming: the contract of foo
`
    });

    it("should work for polymorphic contracts on the identity function", function() {
        @ forall a (a) -> a
        function id(x) { return x; }

        (id(100)).should.equal(100);
    });

    it("should catch a bad application of a polymorphic identity contract", function() {
        @ forall a (a) -> a
        function const5(x) { return 5; }

        blame of {
            const5(5);
        } should be `const5: contract violation
expected: an opaque value
given: 5
in: in the type variable a of
    the return of
    (a) -> a
function const5 guarded at line: 499
blaming: function const5
`
    });

    it("should catch a bad application of a higher-order polymorphic contract", function() {
        @ forall a (a, (a) -> a) -> a
        function foo(x, f) {
            f(x);
            return 100;
        }

        blame of {
            foo(100, function(x) {
                return x;
            });
        } should be `foo: contract violation
expected: an opaque value
given: 100
in: in the type variable a of
    the return of
    (a, (a) -> a) -> a
function foo guarded at line: 516
blaming: function foo
`
    });


    it("should work for polymorphic contracts with a list and a higher-order function", function() {
        @ forall a ([...a], (a) -> a) -> [...a]
        function map(l, f) {
            return l.map(f);
        }

        blame of {
            map([1, 2], function(x) {
                return "a";
            });
        } should be `map: contract violation
expected: (x) => typeof x === 'number'
given: 'a'
in: in the type variable a of
    the return of
    the 2nd argument of
    ([....a], (a) -> a) -> [....a]
function map guarded at line: 539
blaming: (calling context for map)
`
    });


    it("parametric contracts should prevent heterogenous lists", function() {
        @ forall a ([...a]) -> [...a]
        function foo(l) {
            return l;
        }

        blame of {
            foo([1,2,"three"]);
        } should be `foo: contract violation
expected: (x) => typeof x === 'number'
given: 'three'
in: in the type variable a of
    the 2nd field of
    the 1st argument of
    ([....a]) -> [....a]
function foo guarded at line: 562
blaming: (calling context for foo)
`
    });

    it("should catch odds as not a polymorphic function", function() {
        @ forall a ([...a]) -> [...a]
        function odds(l) {
            return l.filter(function(x) {
                return x % 2 !== 0;
            });
        }

        blame of {
            odds([1,2,3,4]);
        } should be `odds: contract violation
expected: value to not be manipulated
given: 'attempted to inspect the value'
in: in the type variable a of
    the 0th field of
    the 1st argument of
    ([....a]) -> [....a]
function odds guarded at line: 582
blaming: function odds
`
    });

    it("should work with function of more than one type variable", function() {
        @ forall a, b, c (a, b, (a, b) -> c) -> c
        function foo(x, y, f) { return f(x, y); }

        (foo(1, 2, function(x, y) { return x + y; })).should.equal(3);

        @ forall a, b, c (a, b, (a, b) -> c) -> c
        function bad_foo(x, y, f) {
            f(x, y);
            return 100;
        }

        blame of {
            bad_foo(1, 2, function(x, y) { return x + y; })
        } should be `bad_foo: contract violation
expected: an opaque value
given: 100
in: in the type variable c of
    the return of
    (a, b, (a, b) -> c) -> c
function bad_foo guarded at line: 609
blaming: function bad_foo
`
    })

    it("should work for inc if odd", function() {
        @ forall a (a) -> a
        function inc_if_odd(x) {
            if (x % 2 !== 0) {
                return x + 1;
            }
            return x;
        }

        blame of {
            inc_if_odd(100);
        } should be `inc_if_odd: contract violation
expected: value to not be manipulated
given: 'attempted to inspect the value'
in: in the type variable a of
    the 1st argument of
    (a) -> a
function inc_if_odd guarded at line: 629
blaming: function inc_if_odd
`
    });

    it("should allow you to define predicate contracts", function() {
        @ ((x) => typeof x === 'number') -> Num
        function id(x) { return x; }

        (id(42)).should.equal(42);
        blame of {
            id("foo")
        } should be `id: contract violation
expected: typeof x === number
given: 'foo'
in: the 1st argument of
    (typeof x === number) -> Num
function id guarded at line: 651
blaming: (calling context for id)
`

    })

    it("should allow you to let bind complex predicate contracts", function() {
        @ let MyNum = (x) => {
            if (typeof x === "number") {
                return true;
            }
            return false;
        }

        @ (MyNum) -> MyNum
        function id(x) { return x; }

        (id(42)).should.equal(42);
        blame of {
            id("foo")
        } should be `id: contract violation
expected: MyNum
given: 'foo'
in: the 1st argument of
    (MyNum) -> MyNum
function id guarded at line: 676
blaming: (calling context for id)
`
    })

    it("should allow you to specify this contracts", function() {
        @ (Num) -> Str
        | this: {name: Str}
        function f(n) { return this.name; }

        var o = {
            nam: "Bob",
            f: f
        };

        blame of {
            o.f(100);
        } should be `f: contract violation
expected: Str
given: undefined
in: the name property of
    the this value of
    (Num) -> Str
    | this: {name: Str}
function f guarded at line: 694
blaming: (calling context for f)
`
    })

    it("should implicitly bind the this macro for method contracts", function() {
        @ let Obj = {
            a: Num,
            f: () -> Num
        }

        @ (Obj) -> Num
        function foo(o) { return o.f(); }


        var obj = {
            a: 42,
            f: function() { return this.a; }
        };

        (foo(obj)).should.equal(42);

        @ (Obj) -> Num
        function badFoo(o) {
            var f = o.f;
            return f();
        }

        blame of {
            badFoo(obj)
        } should be `badFoo: contract violation
expected: an object with at least 2 keys
given: undefined
in: the this value of
    the f property of
    the 1st argument of
    ({a: Num, f: () -> Num}) -> Num
function badFoo guarded at line: 733
blaming: function badFoo
`

    });

    it("should convert predicates in the surrounding scope to contracts", function() {
        function MyNums(val) { return typeof val === "number"; }

        @ (MyNums) -> MyNums
        function id(x) { return x; }

        id(100);

        blame of {
            id("foo");
        } should be `id: contract violation
expected: MyNums
given: 'foo'
in: the 1st argument of
    (MyNums) -> MyNums
function id guarded at line: 757
blaming: (calling context for id)
`
    })

    it("should check recursive object contracts", function() {
        @ let MyObj = Null or {
            a: Num,
            b: MyObj
        }

        @ (MyObj) -> Num
        function foo(o) { return o.b.a; }

        var o = {
            a: 42,
            b: {
                a: 100,
                b: null
            }
        };

        foo(o);

        var badO = {
            a: 42,
            b: {
                a: "str",
                b: null
            }

        };

        blame of {
            foo(badO);
        } should be `foo: contract violation
expected: Null or {a: Num, b: MyObj}
given: 'str'
in: the a property of
    the b property of
    the 1st argument of
    (Null or {a: Num, b: MyObj}) -> Num
function foo guarded at line: 780
blaming: (calling context for foo)
`
    });

    it("should check recursive object contracts for proxied objects", function() {
        @ let MyObj = Null or !{
            a: Num,
            b: MyObj
        }

        @ (MyObj) -> Num
        function foo(o) { return o.b.a; }

        var o = {
            a: 42,
            b: {
                a: 100,
                b: null
            }
        };

        foo(o);

        var badO = {
            a: 42,
            b: {
                a: "str",
                b: null
            }

        };

        blame of {
            foo(badO);
        } should be `foo: contract violation
expected: Null or !{a: Num, b: MyObj}
given: 'str'
in: the a property of
    the b property of
    the 1st argument of
    (Null or !{a: Num, b: MyObj}) -> Num
function foo guarded at line: 822
blaming: (calling context for foo)
`
        @ () -> MyObj
        function bar() {
            return {
                a: 42,
                b: null
            };
        }

        var oo = bar();

        blame of {
            oo.b = {};
        } should be `bar: contract violation
expected: Null or !{a: Num, b: MyObj}
given: undefined
in: the a property of
    setting the b property of
    the return of
    () -> Null or !{a: Num, b: MyObj}
function bar guarded at line: 856
blaming: (calling context for bar)
`
    })

    it("should work with the and contract", function() {
        @ (Num and (x) => x > 5) -> Num
        function foo(x) { return x; }

        foo(10);

        blame of {
            foo("string");
        } should be `foo: contract violation
expected: Num and x > 5
given: 'string'
in: the 1st argument of
    (Num and x > 5) -> Num
function foo guarded at line: 881
blaming: (calling context for foo)
`

        blame of {
            foo(1);
        } should be `foo: contract violation
expected: Num and x > 5
given: 1
in: the 1st argument of
    (Num and x > 5) -> Num
function foo guarded at line: 881
blaming: (calling context for foo)
`
    })

    it("should work for the regex contract", function() {
        @ (/username:\s*[a-zA-Z]*$/) -> Bool
        function checkUsername(str) {
            return true;
        }

        checkUsername("username: bob");
        blame of {
            checkUsername("bad");
        } should be `checkUsername: contract violation
expected: /username:\s*[a-zA-Z]*$/
given: 'bad'
in: the 1st argument of
    (/username:\s*[a-zA-Z]*$/) -> Bool
function checkUsername guarded at line: 910
blaming: (calling context for checkUsername)
`

    });

    it("should blame for calling async function as async", function () {
        @ ((Str) ~> Str) -> Bool
        function foo(asyncFunc) {
            asyncFunc("foo");
            return true;
        }
        blame of {
            foo(function (s) {
                return s;
            });
        } should be `foo: contract violation
expected: call on the next turn of the event loop
given: undefined
in: the 1st argument of
    (async) -> Bool
function foo guarded at line: 930
blaming: function foo
`
    });

    it("should work for calling async function as async", function () {
        @ ((Str) ~> Str) -> Any
        function foo(asyncFunc) {
            return function() { asyncFunc("foo"); };
        }

        var f = foo(function (s) {
            return s;
        });
        f();
    })
});
