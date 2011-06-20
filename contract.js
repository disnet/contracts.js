var C = (function() {
    function blame(toblame, k, val) {
        throw {
            name: "BlameError",
            message: "I blame: " + toblame + " for violating " + k + " with value: " + val
        };
    }

    // contract combinators
    return {
        flat: function(p, name) {
            return function(pos, neg) {
                return function(x) {
                    if (p(x)) 
                        return x;
                    else
                        blame(pos, name, x);
                };
            };
        },
        fun: function(dom, rng) {
            return function(pos, neg) {
                return function(f) {
                    return function(x) {
                        var domp = dom(neg, pos);
                        var rngp = rng(pos, neg);
                        return rngp(f(domp(x)));
                    };
                };
            };
        },
        object: function(oc) {
            return function(pos, neg) {
                return function(obj) {
                    return Proxy.create({
                        getOwnPropertyDescriptor: function(name) {
                            var desc = Object.getOwnPropertyDescriptor(obj, name);
                            if (desc !== undefined) { desc.configurable = true; }
                            return desc;
                        },
                        getPropertyDescriptor: function(name) {
                            var desc = Object.getPropertyDescriptor(obj, name); 
                            if (desc !== undefined) { desc.configurable = true; }
                            return desc;
                        },
                        getOwnPropertyNames: function() {
                            return Object.getOwnPropertyNames(obj);
                        },
                        getPropertyNames: function() {
                            return Object.getPropertyNames(obj);               
                        },
                        defineProperty: function(name, desc) {
                            Object.defineProperty(obj, name, desc);
                        },
                        delete: function(name) { return delete obj[name]; },   
                        fix: function() {
                            if (Object.isFrozen(obj)) {
                                return Object.getOwnPropertyNames(obj).map(function(name) {
                                    return Object.getOwnPropertyDescriptor(obj, name);
                                });
                            }
                            return undefined;
                        },
                        has: function(name) { return name in obj; },
                        hasOwn: function(name) { return Object.prototype.hasOwnProperty.call(obj, name); },
                        get: function(receiver, name) {
                            // interesting stuff here
                            return oc[name](pos, neg)(obj[name]);
                        },
                        set: function(receiver, name, val) {
                            // interesting stuff here
                            obj[name] = oc[name](pos, neg)(val);
                            return true;
                        }, 
                        enumerate: function() {
                            var result = [];
                            for (name in obj) { result.push(name); };
                            return result;
                        },
                        keys: function() { return Object.keys(obj) }
                    });
                };
            };
        },
        any: function(pos, neg) {
            return function(val) {
                return val;
            };
        },
        none: function(pos, neg) {
            return function(val) {
                blame(pos, "none", val);
            };
        },
        and: function(k1, k2) {
            return function(pos, neg) {
                return function(val) {
                    return k2(pos, neg)(k1(pos, neg)(val));
                }
            };
        },
        guard: function(k, x, pos, neg) {
            return k(pos, neg)(x);
        }
    };
})();

var K = (function() {
    // Some basic contracts
    return {
        Number: C.flat(function(x) {
            if(typeof(x) === "number")
                return true;
            else
                return false;
        }, "Number"),
        Odd: C.flat(function(x) {
            if( (x % 2) === 1) 
                return true;
            else
                return false;
        }, "Odd"),
        Even: C.flat(function(x) {
            if( (x % 2) === 1) 
                return false;

            else
                return true;
        }, "Even"),
        Pos: C.flat(function(x) {
            return x >= 0;
        }, "Pos")
    };
})();


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
    }
})();
