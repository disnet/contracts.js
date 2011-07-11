var C = Contracts.combinators, 
    K = Contracts.contracts; 

function load(obj) {
    var name;
    for(name in obj) {
        if(obj.hasOwnProperty(name)) {
            window[name] = obj[name];
        }
    }
}
load(Contracts.combinators);
load(Contracts.contracts);
var server = "server";
var client = "client";


module("Basic Contracts");

test("checking id", function() {
    var id = guard(
        fun(Num, Num),
        function(x) { return x; },
        server, client);

    ok(id(3));
    raises(function() { id("foo"); });
});

test("names of contracts", function() {
    equal(Str.cname, "String");
    equal(Num.cname, "Number");
    // todo: fix
    // equal(M.idObj.id.__cname, "Number -> Number");
});

test("multiple args for function contracts", function() {
    var f1 = function(a, b, c) { return a + 1; };
    var f2 = function(a, b, c) { return b + "foo"; };
    var f3 = function(a, b, c) { return c; };
    var f1c = guard(
        fun([Num, Str, Bool], Num),
        f1,
        server, client);
    var f2c = guard(
        fun([Num, Str, Bool], Str),
        f2,
        server, client);
    var f3c = guard(
        fun([Num, Str, Bool], Str),
        f3,
        server, client);

    equal(f1c(1, "foo", false), 2);
    equal(f2c(1, "foo", false), "foofoo");
    raises(function() { f1c("foo", 1, false); }, "bad client");
    raises(function() { f2c("foo", 1, false); }, "bad client");
    raises(function() { f3c(1, "foo", false); }, "bad server");
});

test("can contract for both function + objects properties", function() {
    var id = function(x, y) { return x; };
    ok(id(4) === 4);
    ok(id.length === 2);
    var idc = guard(
        and(
            fun(Str, Str),
            object({ length: Str })),
        id,
        server, client);
    raises(function() { idc(4) === 4; });
    raises(function() { idc.length; });
});

test("checking arrays", function() {

    raises(function() { guard(List, {length: 3}, server, client); },
           "not a list but looks like it");

    var jsarr = guard(JsArray, [1,2,3], server, client);
    ok(jsarr[0] = 4, "js arrays are mutable");
    ok(delete jsarr[1], "js arrays can have holes");

    var l = [1,2,3];
    var lc = guard(List, l, server, client);
    ok(lc[0]);

    raises(function() { lc[0] = 4; },
           "lists are immutable");

    raises(function() { delete lc[0]; },
           "cannot delete list elements");

    var hole_l = [1,2,3];
    delete hole_l[1];
    raises(function() { guard(List, hole_l, server, client);  },
           "lists have no holes");

    var undef_l = [1,undefined, 3];
    ok(guard(List, undef_l, server, client),
       "lists can have undefined");

    var sl = [1,2,3];
    delete sl[2];
    raises(function() { guard(SaneArray, sl, server, client); },
           "can't contract a sane array with holes");

    var saneArr = guard(SaneArray, [1,2,3], server, client);
    ok(saneArr[1] = 44,
       "sane arrays are mutable");
    raises(function() { delete saneArr[1]; },
           "sane arrays can't have holes");

});

test("checking simple objects", function() {
    var imm = guard(
        object({ x: Num }, {immutable: true}),
        {x: 3},
        server, client);
    raises(function() { imm.x = 55;}, "object is immutable");
    raises(function() { imm.z = 55;}, "object is immutable");

    var imm2 = guard(ImmutableObject, {x: 44}, server, client);
    raises(function() { imm2.x = 55;}, "object is immutable");
    raises(function() { imm2.z = 55;}, "object is immutable");

    var withPre = {x: 0, dec: function() { return --this.x; }};
    ok(withPre.dec() === -1, "works before contract");
    var withPreC = guard(
        object({
            x: Num,
            dec: fun(any, Num, {
                pre: function(obj) {
                    return obj.x > 0;
                },
                post: function(obj) {
                    return obj.x > 0;
                }
            })
        }),
        withPre,
        server, client);
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

    var AC = guard(object({a: fun(any, Str), b: Num}), A, server, client);
    equals(AC.a(), "foo");
    equals(AC.b, 42);
    raises(function() { AC.b = "42"; }, "contract doesn't allow a string to flow to b");
    equals(AC.b, 42, "b was not changed in previous test");

    var ABadC = guard(object({a: fun(any, Num), b: Str}), A, server, client);
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

    var BGoodAttemptC = guard(object({a: fun(any, Str), b: Num}), BBadC, "server", "client");
    raises(function() { BGoodAttemptC.a(); }, "contract on prototype still says there is a problem");
    BBadC.a = function() { return "bar"; };
    equals(BBadC.a(), "bar", "ok now we are shadowning bad contract");

    var B_has_C_not_A = guard(object({a: fun(any, Str), b: Str}),
                                Object.create(A),
                                "server", "client");
    raises(function() { B_has_C_not_A.b; }, "blame even though contract is on object but prop is on proto");
});

test("functions and constructors", function() {
    var id = function(x) { return x; };
    var idc = guard(fun(Num, Num), id, server, client);
    same(idc(4), 4,
         "id obeys contract");
    raises(function() { idc("foo"); },
           "id breaks contract");

    same(new idc(4), 4,
         "id obeys contract and allows being called by new");
    raises(function() { new idc("foo"); },
           "id breaks contract and allows being called by new");

    var id_nonew = guard(fun(Num, Num, {only_call: true} ), id, server, client);
    same(id_nonew(4), 4,
         "nonew obeys contract");
    raises(function() { new id_nonew(4); },
           "nonew obeys contract but called by new");

    raises(function() { id_nonew("foo"); },
           "nonew breaks contract");
    raises(function() { new id_nonew("foo"); },
           "no newbreaks contract and called by new"); // todo: distinguish in blame message

    var id_onlynew = guard(fun(Num, Num, {only_new: true} ), id, server, client);
    raises(function() { id_onlynew(4); },
           "onlynew obeys contract but not called with new");
    same(new id_onlynew(4), 4,
         "onlynew obeys contract and called by new");

    raises(function() { id_onlynew("foo"); },
           "onlynew breaks contract and not called with new");
    raises(function() { new id_onlynew("foo"); },
           "onlynew breaks contract and called by new"); // todo: distinguish in blame message

    // var id_new_with_contract = guard(
    //     fun(Num, Num,
    //           {constructor_contract: [Str, Str]} ),
    //     id,
    //     server, client);
    // same(id_new_with_contract(4), 4,
    //      "new_with_contract obeys contract");
    // same(new id_new_with_contract("foo"), "foo",
    //      "new_with_contract obeys contract when called by new");

    // raises(function() { id_new_with_contract("foo"); },
    //        "new_with_contract breaks contract");
    // raises(function() { new id_new_with_contract(4); },
    //        "new_with_contract breaks contract when called by new"); // todo: distinguish in blame message
});


module("jQuery Contracts");

// test("checking jquery", function() {
//     ok(jQuery.length);
//     equals(jQuery("div").selector, "div");
//     ok(jQuery.apply(this, ["div"]));
//     ok(jQuery([1,2,3]));
//     ok(jQuery(Contracts.C.guard(Contracts.K.Array, [1,2,3], "server", "client")));
//     // want to test grep
// });
