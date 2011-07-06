var C = Contracts.C, // combinators
    K = Contracts.K; // builtin contracts

// testing contracts module
var M = (function () {
    function badAbs(x) {
        return x;
    }
    function id(x) { return x; }

        var o = {
            id: id
        };

    return {
        id: C.guard(C.fun(C.any, C.any), id, "server", "client"),
        idNone: C.guard(C.fun(C.none, C.none), id, "server", "client"),
        idObj: C.guard(C.object({
            id: C.fun(K.Number, K.Number)
        }), o, "server", "client"),
        abs: C.guard(C.fun(K.Number, C.and(K.Number, K.Pos)), Math.abs, "server", "client"),
        badAbs: C.guard(C.fun(K.Number, C.and(K.Number, K.Pos)), badAbs, "server", "client") 
    };
})();

module("Basic Contracts");

test("checking id", function() {
    ok(M.id(3));

    raises(function() { M.idNone(3); });
});

test("names of contracts", function() {
    equal(Contracts.K.String.cname, "String");
    equal(Contracts.K.Number.cname, "Number");
    // todo: fix
    // equal(M.idObj.id.__cname, "Number -> Number");
});

test("checking abs", function() {
    ok(M.abs(4));

    raises(function() { M.abs("foo"); });
    raises(function() { M.badAbs(-4); });
});

test("checking object", function() {
    ok(M.idObj.id(3));

    raises(function() { M.idObj.id("hi"); });
});

test("multiple args for function contracts", function() {
    var f1 = function(a, b, c) { return a + 1; };
    var f2 = function(a, b, c) { return b + "foo"; };
    var f3 = function(a, b, c) { return c; };
    var f1c = Contracts.C.guard(Contracts.C.fun(
        Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean,
        Contracts.K.Number),
                      f1,
                      "server",
                      "client");
    var f2c = Contracts.C.guard(Contracts.C.fun(
        Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean,
        Contracts.K.String),
                      f2,
                      "server",
                      "client");
    var f3c = Contracts.C.guard(Contracts.C.fun(
        Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean,
        Contracts.K.String),
                      f3,
                      "server",
                      "client");

    equal(f1c(1, "foo", false), 2);
    equal(f2c(1, "foo", false), "foofoo");
    raises(function() { f1c("foo", 1, false); }, "bad client");
    raises(function() { f2c("foo", 1, false); }, "bad client");
    raises(function() { f3c(1, "foo", false); }, "bad server");
});

test("can contract for both function + objects properties", function() {
    var id = function(x, y) { return x; };
    var C = Contracts.C, K = Contracts.K;
    ok(id(4) === 4);
    ok(id.length === 2);
    var idc = C.guard(
        C.and(
            C.fun(K.String, K.String),
            C.object({ length: K.String })),
        id,
        "server",
        "client");
    raises(function() { idc(4) === 4; });
    raises(function() { idc.length; });
});

test("checking arrays", function() {

    raises(function() { Contracts.C.guard(Contracts.K.List, {length: 3}, "server", "client"); },
           "not a list but looks like it");

    var jsarr = Contracts.C.guard(Contracts.K.JsArray, [1,2,3], "server", "client");
    ok(jsarr[0] = 4, "js arrays are mutable");
    ok(delete jsarr[1], "js arrays can have holes");

    var l = [1,2,3];
    var lc = Contracts.C.guard(Contracts.K.List, l, "server", "client");
    ok(lc[0]);

    raises(function() { lc[0] = 4; },
           "lists are immutable");

    raises(function() { delete lc[0]; },
           "cannot delete list elements");

    var hole_l = [1,2,3];
    delete hole_l[1];
    raises(function() { Contracts.C.guard(Contracts.K.List, hole_l, "server", "client");  },
           "lists have no holes");

    var undef_l = [1,undefined, 3];
    ok(Contracts.C.guard(Contracts.K.List, undef_l, "server", "client"),
       "lists can have undefined");

    var sl = [1,2,3];
    delete sl[2];
    raises(function() { Contracts.C.guard(Contracts.K.SaneArray, sl, "server", "client"); },
           "can't contract a sane array with holes");

    var saneArr = Contracts.C.guard(Contracts.K.SaneArray, [1,2,3], "server", "client");
    ok(saneArr[1] = 44,
       "sane arrays are mutable");
    raises(function() { delete saneArr[1]; },
           "sane arrays can't have holes");

});

test("checking simple objects", function() {
    var imm = Contracts.C.guard(
        Contracts.C.object({ x: Contracts.K.Number }, {immutable: true}),
        {x: 3},
        "server", "client");
    raises(function() { imm.x = 55;}, "object is immutable");
    raises(function() { imm.z = 55;}, "object is immutable");

    var imm2 = Contracts.C.guard(Contracts.K.ImmutableObject, {x: 44}, "server", "client");
    raises(function() { imm2.x = 55;}, "object is immutable");
    raises(function() { imm2.z = 55;}, "object is immutable");

    var withPre = {x: 0, dec: function() { return --this.x; }};
    ok(withPre.dec() === -1, "works before contract");
    var withPreC = Contracts.C.guard(
        Contracts.C.object({
            x: Contracts.K.Number,
            dec: Contracts.C.fun(Contracts.C.any, Contracts.K.Number, {
                pre: function(obj) {
                    return obj.x > 0;
                },
                post: function(obj) {
                    return obj.x > 0;
                }
            })
        }),
        withPre,
        "server", "client");
    raises(function() { withPreC.dec(); }, "doesn't pass precondition");
    withPreC.x = 1;
    raises(function() { withPreC.dec(); }, "doesn't pass postcondition");
});

test("checking prototypes", function() {
    var A = {
        a: function() { return "foo"; },
        b: 42
    };
    equals(A.a(), "foo");
    equals(A.b, 42);

    var AC = C.guard(C.object({a: C.fun(C.any, K.String), b: K.Number}), A, "server", "client");
    equals(AC.a(), "foo");
    equals(AC.b, 42);
    raises(function() { AC.b = "42"; }, "contract doesn't allow a string to flow to b");
    equals(AC.b, 42, "b was not changed in previous test");

    var ABadC = C.guard(C.object({a: C.fun(C.any, K.Number), b: K.String}), A, "server", "client");
    raises(function() { ABadC.a(); }, "contract says number but function give string");
    raises(function() { ABadC.b; }, "contract doesn't match value stored in b");

    var B = Object.create(A);
    equals(B.a(), "foo");
    equals(B.b, 42);

    var BC = Object.create(AC);
    equals(BC.a(), "foo");
    equals(BC.b, 42);
    ok(BC.b = "foo", "since b is assigned to BC not proto there is not contract to stop it");
    equals(BC.b, "foo");

    var BBadC = Object.create(ABadC);
    raises(function() { BBadC.a(); }, "contract on prototype says number but gives string");
    raises(function() { BBadC.b; }, "contract on proto still doesn't match value stored in b");

    var BGoodAttemptC = C.guard(C.object({a: C.fun(C.any, K.String), b: K.Number}), BBadC, "server", "client");
    raises(function() { BGoodAttemptC.a(); }, "contract on prototype still says there is a problem");
    BBadC.a = function() { return "bar"; };
    equals(BBadC.a(), "bar", "ok now we are shawdowning bad contract");

    var B_has_C_not_A = C.guard(C.object({a: C.fun(C.any, K.String), b: K.String}),
                                Object.create(A),
                                "server", "client");
    raises(function() { B_has_C_not_A.b; }, "blame even though contract is on object but prop is on proto");
});


module("jQuery Contracts");

test("checking jquery", function() {
    ok(jQuery.length);
    equals(jQuery("div").selector, "div");
    ok(jQuery.apply(this, ["div"]));
    ok(jQuery([1,2,3]));
    ok(jQuery(Contracts.C.guard(Contracts.K.Array, [1,2,3], "server", "client")));
    // want to test grep
});
