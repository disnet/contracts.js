/*global Proxy: true, */

/*jslint white: false, plusplus: false */


var Contracts = (function() {
    "use strict";

    if(!Array.isArray){ // needed for cross browser...not that it matters with proxies atm
        Array.isArray = (function(){
            var builtInToString = Object.prototype.toString; // save a reference built-in Object.prototype.toString
            var builtInToCall = Function.prototype.call; // save a reference to built-in Function.prototype.call
            var callWithArgs = builtInToCall.bind(builtInToCall); // requires a built-in bind function, not a shim
            
            var argToString = function(o){
                return callWithArgs(builtInToString, o);
            };
            
            return function(o) { 
                return argToString(o) === '[object Array]';
            };
        })();
    }

    function blame(toblame, k, val) {
        throw {
            name: "BlameError",
            message: "I blame: " + toblame + " for violating '" + k + "' with value: " + val
        };
    }

    function hasNoHoles(obj) {
        var i = 0;
        for( ; i < obj.length; i++) {
            if(!(i in obj))
                return false;
        }
        return true;
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
    function Contract(cname, handler) {
        this.handler = handler;
        this.cname = cname;
    }
    Contract.prototype = {
        // a -> (a + Blame)
        check : function(val) {
            return this.handler(val);
        },
        // (a -> (a + Blame)) -> Contract
        setHandler : function(handler) {
            this.handler = handler;
            return this;
        },
        // String x String -> Contract
        posNeg : function(pos, neg) {
            this.pos = pos;
            this.neg = neg;
            return this;
        }
    };

    // contract combinators
    var combinators = {
        flat: function(p, name) {
            return new Contract(name, function(val) {
                if (p(val)) {
                    return val;
                } else {
                    blame(this.pos, this.cname, val);
                }
            });
        },
        // dependent functions, rng is a function that takes
        // the arguments originally passed to the called function
        // and returns a contract.
        // rng : [args] -> Contract
        funD: function(dom, rng) {
            return new Contract(dom.cname + " -> " + rng.cname, function(f) {
                // todo: check that f is actually a function
                var handler = idHandler(f);
                var that = this; // right this?
                var fp = Proxy.createFunction(handler,
                                              function() {
                                                  var i = 0,
                                                      rngc;
                                                  if(!Array.isArray(dom)) {
                                                      // todo commenting out strict checking for now...might want a way
                                                      // to chose to be super strict about # of arguments matching the
                                                      // # of contracts

                                                      // if(arguments.length > 1) { // not doing === 1 since contract could be any and accept undefined
                                                      //     // todo: better messaging that was called with too many arguments
                                                      //     blame(that.pos, dom, arguments); 
                                                      // }
                                                      dom.posNeg(that.neg, that.pos).check(arguments[0]);
                                                  } else {
                                                      // if(arguments.length !== dom.length) {
                                                      //     // todo: better messaging that was called with too many arguments
                                                      //     blame(that.pos, dom, arguments); 
                                                      // }
                                                      for( ; i < arguments.length; i++) {
                                                          dom[i].posNeg(that.neg, that.pos).check(arguments[i]);
                                                      }
                                                  }
                                                  rngc = rng(arguments);
                                                  return rngc.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                              },
                                              function() {
                                                  // todo: think through this more, how should we deal with constructors?
                                                  // var rng, i;
                                                  // for(i = 0; i < args.length; i++) {
                                                  //     dom[i].posNeg(that.neg, that.pos).check(args[i]);
                                                  // }
                                                  // return rng.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                                  return f.apply(this, arguments);
                                              });
                fp.__cname = this.cname;
                return fp;
            });
        },
        fun: function(dom, rng) {
            return this.funD(dom, function() { return rng; });
        },
        object: function(objContract, options) {
            var c = new Contract("object", function(obj) {
                // todo check that obj is actually an object
                var missingProps, op, i, 
                handler = idHandler(obj);
                var that = this;
                handler.get = function(receiver, name) {
                    if(that.oc.hasOwnProperty(name)) { 
                        return that.oc[name].posNeg(that.pos, that.neg).check(obj[name]);
                    } else {
                        return obj[name];
                    }
                };
                handler.set = function(receiver, name, val) {
                    // todo: how should this interact with frozen objects?
                    if(options && options.immutable) { // fail if attempting to set an immutable object
                        blame(that.pos, that.oc, obj);
                    }
                    if(that.oc.hasOwnProperty(name)) { 
                        obj[name] = that.oc[name].posNeg(that.pos, that.neg).check(val);
                    } else {
                        obj[name] = val;
                    }
                    return true;
                };
                if(options && options.noDelete) {
                    handler.delete = function(name) {
                        blame(that.pos, that.oc, obj);
                    };
                }
                // check that all properties on the object have a contract
                missingProps = Object.keys(this.oc).filter(function(el) {
                    // using `in` instead of `hasOwnProperty` to
                    // allow property to be somewhere on the prototype chain
                    // todo: are we sure this is what we want? need a way to specify
                    // a prop *must* be on the object?
                    return !(el in obj); 
                });
                if(missingProps.length !== 0) {
                    // todo: use missingProps to get more descriptive blame msg
                    blame(this.pos, this.oc, obj);
                }

                if(options && options.initPredicate) {
                    // check each predicate if we have more than one
                    if(Array.isArray(options.initPredicate)) {
                        for( i = 0; i < options.initPredicate.length; i++) {
                            if(!options.initPredicate[i](obj))
                                blame(this.pos, this.oc, obj);
                        }
                    } else {
                        if(!options.initPredicate(obj))
                            blame(this.pos, this.oc, obj);
                    }
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
                return op;
            });
            c.oc = objContract;
            // Allows us to add property's to the object
            // contract after initialization. Useful for
            // recursive contracts.
            c.addPropertyContract = function(newOc) {
                var name;
                for(name in newOc) {
                    if(newOc.hasOwnProperty(name)) {
                        this.oc[name] = newOc[name];
                    }
                }
                return this;
            };
            return c;
        },
        any: (function() {
            return new Contract("any", function(val) {
                return val;
            });
        })(),
        or: function(ks) {
            // todo: could be nicer here and use arguments to accept varargs
            if(!Array.isArray(ks)) {
                throw {
                    name: "BadContract",
                    message: "Must create the 'or' contract with an array of contracts"
                };
            }
            return new Contract("or", function(val) {
                var i = 0, lastBlame;
                // for now only accepting first order contracts for 'or'
                if (typeof val === "function") {
                    blame(this.pos, "or", val);
                }
                for(; i < ks.length; i++) {
                    try {
                        return ks[i].posNeg(this.pos, this.neg).check(val);
                    } catch (e) {
                        lastBlame = e;
                        continue;
                    }
                }
                throw lastBlame; // the last contract in the array still assigned blame so surface it
            });
        },
        none: (function() {
            return new Contract("none", function(val) {
                blame(this.pos, "none", val);
            });
        })(),
        and: function(k1, k2) {
            return new Contract("and", function(val) {
                var k1c = k1.posNeg(this.pos, this.neg).check(val);
                return k2.posNeg(this.pos, this.neg).check(k1c);
            });
        },
        guard: function(k, x, pos, neg) {
            return k.posNeg(pos, neg).check(x);
        }
    },
    // Some basic contracts
    contracts = {
        Undefined: combinators.flat(function(x) {
            return undefined === x;
        }, "Undefined"),
        Null : combinators.flat(function(x) {
            return null === x;
        }, "Null"),
        Number: combinators.flat(function(x) {
            return typeof(x) === "number";
        }, "Number"),
        Boolean : combinators.flat(function(x) {
            return typeof(x) === "boolean";
        }, "Boolean"),
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
        }),
        List: combinators.object({}, {
            immutable: true,
            noDelete: true,
            initPredicate: [Array.isArray, hasNoHoles]
        }),
        SaneArray: combinators.object({}, {
            immutable: false,
            noDelete: true,
            initPredicate: [Array.isArray, hasNoHoles]
        }),
        JsArray: combinators.object({}, {
            immutable: false,
            noDelete: false,
            initPredicate: Array.isArray
        })
    };
    return {
        C: combinators,
        K: contracts
    };
})();
