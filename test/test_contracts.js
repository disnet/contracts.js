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
        @ (Num, opt Str) -> Num
        function f(x, s) {
            return x;
        }

        (f(100)).should.equal(100);
    });

    it("should blame when optional arguments are wrong", function() {
        @ (Num, opt Str) -> Num
        function f(x, s) {
            return x;
        }

        blame of {
            f(100, 100);
        } should be `f: contract violation
expected: Str
given: 100
in: the 2nd argument of
    (Num, opt Str) -> Num
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
        @ ({foo: opt Str}) -> Str
        function f(o) { return "str"; }

        (f({bar: 42})).should.equal("str");
    });

    it("should blame when an optional contract is violated for an object", function() {
        @ ({foo: opt Str}) -> Str
        function f(o) { return "str"; }

        blame of {
            f({foo: 42});
        } should be `f: contract violation
expected: Str
given: 42
in: the foo property of
    the 1st argument of
    ({foo: opt Str}) -> Str
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

    it("should work for polymorphic contracts", function() {
        @ forall a ([...a], (a) -> a) -> [...a]
        function map(l, f) {
            return l.map(f);
        }

        map([1, 2], function(x) {
            return x.toString();
        })
    })

});
