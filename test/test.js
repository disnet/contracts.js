// testing contracts module
var M = (function () {
    function badAbs(x) {
        return x;
    }
    function id(x) { return x; }

    var C = Contracts.C, // combinators
        K = Contracts.K, // builtin contracts
        o = {
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
        [Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean],
        Contracts.K.Number),
                      f1,
                      "server",
                      "client");
    var f2c = Contracts.C.guard(Contracts.C.fun(
        [Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean],
        Contracts.K.String),
                      f2,
                      "server",
                      "client");
    var f3c = Contracts.C.guard(Contracts.C.fun(
        [Contracts.K.Number, Contracts.K.String, Contracts.K.Boolean],
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

module("jQuery Contracts");

test("checking jquery", function() {
    ok(jQuery.length);
    equals(jQuery("div").selector, "div");
    ok(jQuery.apply(this, ["div"]));
    ok(jQuery([1,2,3]));
    ok(jQuery(Contracts.C.guard(Contracts.K.Array, [1,2,3], "server", "client")));
    // want to test grep
});
