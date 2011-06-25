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
    equal(M.idObj.id.__cname, "Number -> Number");
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

test("can contract for both function + objects properties", function() {
    var id = function(x, y) { return x; }
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

module("jQuery Contracts");

test("checking jquery", function() {
    equals(jQuery("div").selector, "div");
    ok(jQuery.apply(this, ["div"]));
    ok(jQuery([1,2,3]));
    ok(jQuery(Contracts.C.guard(Contracts.K.Array, [1,2,3], "server", "client")));
});
