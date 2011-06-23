test("checking id", function() {
    ok(M.id(3));

    raises(function() { M.idNone(3); });
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
        C.fun(K.String, K.String),
        id,
        "server",
        "client");
    raises(function() { idc(4) === 4; });
    raises(function() { idc.length; });
});

// test("checking jquery", function() {
//     raises(function() { jQuery.myVerySpecialProperty; });
//     // Note: different than real test...jQuery.noConflict will return the original
//     // non-proxied non-contracted version of the jQuery object
//     notEqual( jQuery, jQuery.noConflict(), "noConflict returned the jQuery object" );
// });

test("checking jquery", function() {
    ok(jQuery("div"));
    ok(jQuery.apply(this, ["div"]));
    ok(jQuery([1,2,3]));
    // ok(jQuery(Contracts.C.guard(Contracts.K.Array, [1,2,3], "server", "client")));
    
});
