/*global Proxy: true, */
/*jslint white: false, plusplus: false */

var Contracts = (function() {
    "use strict";
    function blame(toblame, k, val) {
        throw {
            name: "BlameError",
            message: "I blame: " + toblame + " for violating '" + k + "' with value: " + val
        };
    }

    // creates the properties that behave as an identity for a Proxy
    function idHandler(obj) {
        return {
            getOwnPropertyDescriptor: function(name) {
                var desc = Object.getOwnPropertyDescriptor(obj, name);
                if (desc !== undefined) { desc.configurable = true; }
                return desc;
            },
            getPropertyDescriptor: function(name) {
                var o = obj;
                // walk the prototype chain checking for the given property
                do {
                    var desc = Object.getOwnPropertyDescriptor(o, name); 
                    if (desc !== undefined) {
                        desc.configurable = true;
                        return desc;
                    }
                    o = Object.getPrototypeOf(o);
                } while(o !== null);
                return undefined;
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
            enumerate: function() {

                var result = [],
                name;
                for (name in obj) { result.push(name); }
                return result;
            },
            get: function(receiver, name) {
                return obj[name];
            },
            set: function(receiver, name, val) {
                obj[name] = val;
                return true;
            },
            keys: function() { return Object.keys(obj); }
        };
    }

    // contract combinators
    var combinators = {
        flat: function(p, name) {
            return function(pos, neg) {
                var k = function (x) {
                    if (p(x)) {
                        return x;
                    } else {
                        blame(pos, name, x);
                    }
                };
                k.cname = name;
                return k;
            };
        },
        fun: function(dom, rng) {
            return function(pos, neg) {
                var k = function(f) {
                    var handler = idHandler(f);
                    var fp = Proxy.createFunction(handler,
                                                function(args) {
                                                    var i = 0;
                                                    // single argument
                                                    if(typeof dom === "function") {
                                                        // todo: what about single arg contract but
                                                        // function called with multiple arguments
                                                        dom(neg, pos)(args);
                                                    } else {
                                                        // assuming multiple arguments, should fail if assumption is wrong
                                                        // -- wish I could use some contracts here :)
                                                        for( ; i < args.length; i++) {
                                                            dom[i](neg, pos)(arguments[i]);
                                                        }
                                                    }
                                                    return rng(pos, neg)(f.apply(this, arguments));
                                                },
                                                function(args) {
                                                    // todo: think through this more, how should we deal with constructors?
                                                    var rng, i;
                                                    for(i = 0; i < args.length; i++) {
                                                        dom[i](neg, pos)(args[i]);
                                                    }
                                                    return rng(pos, neg)(f.apply(this, arguments));
                                                });
                    // todo: naming here is *wrong*. cname is on the original `f` so if we apply
                    // multiple function contracts, cname will hold the last one.
                    fp.cname = dom(neg, pos).cname + " -> " + rng(pos, neg).cname;
                    return fp
                };
                k.cname = "->";
                return k;
            };
        },
        object: function(objContract) {
            return function(pos, neg) {
                var k = function(obj) {
                    var missingProps, op,
                        handler = idHandler(obj);
                    handler.get = function(receiver, name) {
                        if(objContract.hasOwnProperty(name)) { 
                            return objContract[name](pos, neg)(obj[name]);
                        } else {
                            return obj[name];
                        }
                    };
                    handler.set = function(receiver, name, val) {
                        if(objContract.hasOwnProperty(name)) { 
                            obj[name] = objContract[name](pos, neg)(val);
                        } else {
                            obj[name] = val;
                        }
                        return true;
                    };
                    // check that all properties on the object have a contract
                    missingProps = Object.keys(objContract).filter(function(el) {
                        // using `in` instead of `hasOwnProperty` to
                        // allow property to be somewhere on the prototype chain
                        // todo: are we sure this is what we want? need a way to specify
                        // a prop *must* be on the object?
                        return !(el in obj); 
                    });
                    if(missingProps.length !== 0) {
                        // todo: use missingProps to get more descriptive blame msg
                        blame(pos, objContract, obj);
                    }
                    // making this a function proxy if object is also a function to preserve
                    // typeof checks
                    if (typeof obj === "function") {
                        op = Proxy.createFunction(handler,
                                                  function(args) {
                                                      return obj.apply(this, arguments);
                                                  },
                                                  function(args) {
                                                      return obj.apply(this, arguments);
                                                  });

                    } else {
                        op = Proxy.create(handler);// todo: what about the prototype? defaulting to null
                    }
                    op.cname = "object {}";
                    return op;
                };
                k.cname = "object";
                return k;
            };
        },
        any: (function() {
            return function(pos, neg) {
                var k = function(val) {
                    return val;
                };
                k.cname = "any";
                return k;
            };
        })(),
        or: function(k1, k2) {
            return function(pos, neg) {
                var k = function(val) {
                    // for now only accepting first order contracts for 'or'
                    if (typeof val === "function") {
                        blame(pos, "or", val);
                    }
                    var k1c = k1(pos, neg),
                        k2c = k2(pos, neg);
                    try {
                        return k1c(val);
                    } catch (e) {
                        return k2c(val);
                    }
                };
                k.cname = "or";
                return k;
            };
        },
        none: (function() {
            return function(pos, neg) {
                var k = function(val) {
                    blame(pos, "none", val);
                };
                k.cname = "none";
                return k;
            };
        })(),
        and: function(k1, k2) {
            return function(pos, neg) {
                var k = function(val) {
                    return k2(pos, neg)(k1(pos, neg)(val));
                };
                k.cname = "and";
                return k;
            };
        },
        guard: function(k, x, pos, neg) {
            return k(pos, neg)(x);
        }
    },
    // Some basic contracts
    contracts = {
        Number: combinators.flat(function(x) {
            return typeof(x) === "number";
        }, "Number"),
        String: combinators.flat(function(x) {
            return typeof(x) === "string";
        }, "String"),
        Odd: combinators.flat(function(x) {
            return  (x % 2) === 1;
        }, "Odd"),
        Even: combinators.flat(function(x) {
            return (x % 2) === 1;
        }, "Even"),
        Pos: combinators.flat(function(x) {
            return x >= 0;
        }, "Pos"),
        Array: combinators.object({
            length: combinators.flat(function(x) {
                return typeof(x) === "number";
            }, "Number")
        })
    };
    return {
        C: combinators,
        K: contracts
    };
})();
