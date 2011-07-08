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

    // takes the arguments object to a function combinator which can have variable number of
    // domain arguments along with an optional "options" object. 
    // @returns [dom :: [contract], rng :: contract, options :: object]
    function parseArguments(args) {
        var dom, rng, options, rngIndex, i,
            optionsOrRng = args[args.length - 1];
        if(typeof optionsOrRng === "function") { // case when there is no options argument
            rng = optionsOrRng;
            options = undefined;
            rngIndex = args.length - 1;
        } else {
            optionsOrRng = args[args.length - 2]; // option argument so have to go back two for the real contract
            if(typeof optionsOrRng === "function") {
                rng = optionsOrRng;
                options = args[args.length - 1];
                rngIndex = args.length - 2;
            } else {
                throw "Neither of the last two arguments to function combinator was a range contact";
            }
        }
        dom = [];
        for(i = 0; i < rngIndex; i++) {
            dom.push(args[i]);
        }
        // ...all this to make calling with an unknown number of domain contracts clean
        return [dom, rng, options];
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
        funD: function() {
            var dom, rng, options, raw_args;
            raw_args = parseArguments(arguments);
            dom = raw_args[0];
            rng = raw_args[1];
            options = raw_args[2];

            return new Contract(dom.cname + " -> " + rng.cname, function(f) {
                // todo: check that f is actually a function
                if(typeof f !== "function") {
                    blame(this.pos, f, "not a function"); // todo fix blame message
                }
                var only_call = options && options.only_call;
                var only_new = options && options.only_new;
                var constructor_contract = options && options.constructor_contract;
                var handler = idHandler(f);
                var that = this; 
                var fp = Proxy.createFunction(handler,
                                              function() {
                                                  var i, rngc, res;
                                                  if(only_new) {
                                                      blame(that.pos, "fun", "only_call");
                                                  }
                                                  // check pre condition
                                                  if(options && typeof options.pre === "function") {
                                                      if(!options.pre(this)) {
                                                          blame(that.pos, "fun", "precond"); // todo: fix up blame message
                                                      }
                                                  }
                                                  // check each of the arguments that we have a domain contract for
                                                  for( i = 0 ; i < dom.length; i++) { 
                                                      dom[i].posNeg(that.neg, that.pos).check(arguments[i]);
                                                  }
                                                  // send the arguments to the dependent range
                                                  rngc = rng(arguments);
                                                  // apply function and check range
                                                  res = rngc.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                                  // check post condition
                                                  if(options && typeof options.post === "function") {
                                                      if(!options.post(this)) {
                                                          blame(that.pos, "fun", "postcond"); // todo: fix up blame message
                                                      }
                                                  }
                                                  return res;
                                              },
                                              function() {
                                                  // todo...some ugly copy/paste to fix here
                                                  var dom_const = dom, rng_const = rng, i, rngc, res;
                                                  if(only_call) {
                                                      blame(that.pos, "fun", "only_call");
                                                  } else if(constructor_contract !== undefined) {
                                                      // var raw_args = parseArguments(constructor_contract);
                                                      // dom_const = raw_args[0];
                                                      // rng_const = raw_args[1];
                                                  }

                                                  // check pre condition
                                                  if(options && typeof options.pre === "function") {
                                                      if(!options.pre(this)) {
                                                          blame(that.pos, "fun", "precond"); // todo: fix up blame message
                                                      }
                                                  }
                                                  // check each of the arguments that we have a domain contract for
                                                  for( i = 0 ; i < dom_const.length; i++) { 
                                                      dom_const[i].posNeg(that.neg, that.pos).check(arguments[i]);
                                                  }
                                                  // send the arguments to the dependent range
                                                  rngc = rng_const(arguments);
                                                  // apply function and check range
                                                  res = rngc.posNeg(that.pos, that.neg).check(f.apply(this, arguments));
                                                  // check post condition
                                                  if(options && typeof options.post === "function") {
                                                      if(!options.post(this)) {
                                                          blame(that.pos, "fun", "postcond"); // todo: fix up blame message
                                                      }
                                                  }
                                                  return res;
                                              });
                fp.__cname = this.cname;
                return fp;
            });
        },
        fun: function(dom, rng, options) {
            var optionsOrRng = arguments[arguments.length - 1];
            if(optionsOrRng instanceof Contract) { // case when there is no options argument
                // wrapping in empty function for dependent combinator
                arguments[arguments.length - 1] = function() { return optionsOrRng; };
            } else {
                optionsOrRng = arguments[arguments.length - 2]; // option argument so have to go back two for the real contract
                if(optionsOrRng instanceof Contract) {
                    // wrapping in empty function for dependent combinator
                    arguments[arguments.length - 2] = function() { return optionsOrRng; };
                } else {
                    throw "Neither of the last two arguments to function combinator was a range contact";
                }
            }

            return this.funD.apply(this, arguments);
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
                // todo eagerly check the properties?

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
        }),
        ImmutableObject: combinators.object({}, {immutable: true})
    };
    return {
        C: combinators,
        K: contracts
    };
})();
