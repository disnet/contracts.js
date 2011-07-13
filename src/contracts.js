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

    // merges props of o2 into o1 return o1
    function merge(o1, o2) {
        var o3 = {};
        var f = function(o) {
            for(var name in o) {
                if(o.hasOwnProperty(name)) {
                    o3[name] = o[name];
                }
            }
        };
        f(o1);
        f(o2);
        return o3;
    };

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

    // (any -> Bool), [Str] -> Contract
    var check = function(p, name) {
        return new Contract(name, function(val) {
            if (p(val)) {
                return val;
            } else {
                blame(this.pos, this.cname, val);
            }
        });
    };

    // (Contract or arr(Contract)),     -- The domain contract - use array for multiple arguments
    // ((any -> Contract) or Contract), -- The range contract - function if dependent 
    // Opt({                            -- Options object
    //   callOnly: Bool                 -- only allowed to call without new (this and newOnly cannot both be true)
    //   newOnly: Bool                  -- only allowed to call with new (this and callOnly cannot both be true)
    //   pre: (any -> Bool)             -- pre condition predicate
    //   post: (any -> Bool)            -- post condition predicate
    //   this: object{...})             -- object contract to check 'this'
    // })                     
    // -> Contract                      -- Resulting contract
    // OR
    // {
    //   call: arr(Contract or arr(Contract), Contract),
    //   new: arr(Contract or arr(Contract), Contract)
    // }
    // -> Contract
    var fun = function(dom, rng, options) {
        var callOnly, newOnly, cleanDom,
            newdom, newrng, calldom, callrng;

        cleanDom = function(dom) {
            // wrap the domain in array so we can be consistent
            if (dom instanceof Contract) { 
                dom = [dom];
            }
            // don't allow required argument contracts to follow optional
            dom.reduce(function(prevWasOpt, curr) {
                if(curr.cname === "opt") {
                    return true;
                } else {
                    if(prevWasOpt) {
                        throw "Illagal arguments: required argument following an optional argument.";
                    } else {
                        return false;
                    }
                }
            }, false);
            return dom;
        };

        // dom is overloaded so check if was called as
        // an object with the contracts for call/new
        if(dom && dom.call && dom.new) {
            // different rng/dom for call/new
            calldom = cleanDom(dom.call[0]);
            callrng = dom.call[1];
            newdom = cleanDom(dom.new[0]);
            newrng = dom.new[1];
            options = rng || {};
        } else {
            // rng/dom for call/new are the same
            calldom = cleanDom(dom);
            callrng = rng;
            newdom = calldom;
            newrng = callrng;
            options = options || {};
        }

        callOnly = options && options.callOnly;
        newOnly = options && options.newOnly;

        // todo: turn this into an example contract
        if(callOnly && newOnly) {
            throw "Cannot have a function be both newOnly and newSafe";
        }

        if(newOnly && options.this) {
            throw "Illegal arguments: cannot have both newOnly and a contract on 'this'";
        }

        // todo: better name for case when we have both call and new contracts
        return new Contract(calldom.cname + " -> " + callrng.cname, function(f) {
            // todo: check that f is actually a function
            if(typeof f !== "function") {
                blame(this.pos, f, "not a function"); // todo fix blame message
            }
            var handler = idHandler(f);
            var that = this; 
            var callHandler, newHandler;

            // options:
            // { isNew: Bool   - make a constructor handler (to be called with new)
            //   newSafe: Bool - make call handler that adds a call to new
            //   pre: ({} -> Bool) - function to check preconditions
            //   post: ({} -> Bool) - function to check postconditions
            //   this: {...} - object contract to check 'this'
            // }
            var makeHandler = function(dom, rng, options) {
                return function() {
                    var i, res, args = [], boundArgs, bf, thisc;

                    // check pre condition
                    if(typeof options.pre === "function") {
                        if(!options.pre(this)) {
                            blame(that.pos, "fun", "precond"); // todo: fix up blame message
                        }
                    }

                    // check all the arguments
                    for( i = 0; i < dom.length; i++) { 
                        // might pass through undefined which is fine (opt will take
                        // care of it if the argument is actually optional)
                        //
                        // blame is reversed
                        args[i] = dom[i].posNeg(that.neg, that.pos).check(arguments[i]);
                        // assigning back to args since we might be wrapping functions/objects
                        // in delayed contracts
                    }

                    if(typeof rng === "function") {
                        // send the arguments to the dependent range
                        rng = rng.apply(this, args);
                    }

                    // apply the function and check its result
                    if(options.isNew || options.newSafe) {
                        // null is in the 'this' argument position for bind...
                        // bind will ignore the supplied 'this' when we call it with new 
                        boundArgs = [].concat.apply([null], args);
                        bf = f.bind.apply(f, boundArgs);
                        res = new bf();
                        res = rng.posNeg(that.pos, that.neg).check(res);
                    } else {
                        if(options.this) {
                            thisc = options.this.posNeg(that.pos, that.neg).check(this);
                        } else {
                            thisc = this;
                        }
                        res = rng.posNeg(that.pos, that.neg).check(f.apply(thisc, args));
                    }

                    // check post condition
                    if(typeof options.post === "function") {
                        if(!options.post(this)) {
                            blame(that.pos, "fun", "postcond"); // todo: fix up blame message
                        }
                    }
                    return res;
                };
            };

            if(newOnly) {
                options.isNew = true;
                callHandler = function() {
                    blame(that.pos, "fun", "new only");
                };
                newHandler = makeHandler(newdom, newrng, options);
            } else if(callOnly) {
                options.isNew = false;
                newHandler = function() {
                    blame(that.pos, "fun", "call only");
                };
                callHandler = makeHandler(calldom, callrng, options);
            } else { // both false...both true is a contract construction-time error and handled earlier
                callHandler = makeHandler(calldom, callrng, options);
                newHandler = makeHandler(newdom, newrng, options);
            }
            var fp = Proxy.createFunction(handler, callHandler, newHandler);
            fp.__cname = this.cname;
            return fp;
        });
    };


    var ctor = function(dom, rng, options) {
        var opt = merge(options, {newOnly: true});
        return fun(dom, rng, opt);
    };

    var ctorSafe = function(dom, rng, options) {
        var opt = merge(options, {newSafe: true});
        return fun(dom, rng, opt);
    };

    var object = function(objContract, options) {
        var c = new Contract("object", function(obj) {
            var missingProps, op, i, 
                handler = idHandler(obj);
            var that = this;
            options = options || {};

            if(!(obj instanceof Object)) {
                blame(this.pos, "object", "not an object");
            }
            if(options.extensible === true && !Object.isExtensible(obj)) {
                blame(this.pos, "object", "not a extensible object");
            }
            if(options.extensible === false && Object.isExtensible(obj)) {
                blame(this.pos, "object", "extensible object");
            }
            if(options.sealed === true && !Object.isSealed(obj)) {
                blame(this.pos, "object", "not a sealed object");
            }
            if(options.sealed === false && Object.isSealed(obj)) {
                blame(this.pos, "object", "sealed object");
            }
            if(options.frozen === true && !Object.isFrozen(obj)) {
                blame(this.pos, "object", "not a frozen object");
            }
            if(options.frozen === false && Object.isFrozen(obj)) {
                blame(this.pos, "object", "frozen object");
            }

            handler.defineProperty = function(name, desc) {
                if(!options.extensible || options.sealed || options.frozen) {
                    blame(that.pos, obj, "object is non-extensible");
                }
                Object.defineProperty(obj, name, desc);
            };
            handler.delete = function(name) {
                if(options.sealed || options.frozen) {
                    blame(that.pos, obj, "object is " + (options.sealed ? "sealed" : "frozen"));
                }
                return delete obj[name]; 
            };
            handler.get = function(receiver, name) {
                if(that.oc.hasOwnProperty(name)) { 
                    return that.oc[name].posNeg(that.pos, that.neg).check(obj[name]);
                } else {
                    return obj[name];
                }
            };
            handler.set = function(receiver, name, val) {
                if(!options.extensible && Object.getOwnPropertyDescriptor(obj, name) === undefined) {
                    blame(that.pos, obj, "non-extensible object");
                }
                if(options.frozen) {
                    // normally would silengtly fail or throw a type error (strict mode)
                    // but now we throw blame for better messaging
                    blame(that.pos, obj, "frozen object");
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
                // if it's the optional contract ignore
                if(that.oc[el].cname === "opt") {
                    return false;
                }
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
                op = Proxy.create(handler, Object.prototype); // todo: is this the proto we actually want?
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
    };

    var any = (function() {
        return new Contract("any", function(val) {
            return val;
        });
    })();

    var or = function(ks) {
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
    };
    
    var none = (function() {
        return new Contract("none", function(val) {
            blame(this.pos, "none", val);
        });
    })();

    var and = function(k1, k2) {
        return new Contract("and", function(val) {
            var k1c = k1.posNeg(this.pos, this.neg).check(val);
            return k2.posNeg(this.pos, this.neg).check(k1c);
        });
    };

    var opt = function(k) {
        return new Contract("opt", function(val) {
            if(val === undefined) { // unsuplied arguments are just passed through
                return val;
            } else {
                // arg is actually something so check the underlying contract
                return k.posNeg(this.pos, this.neg).check(val);
            }
        });
    };

    var guard = function(k, x, pos, neg) {
        return k.posNeg(pos, neg).check(x);
    };

    var combinators = {
        check: check,
        fun: fun,
        ctor: ctor,
        ctorSafe: ctorSafe,
        object: object,
        any: any,
        or: or,
        none: none,
        and: and,
        opt: opt,
        guard: guard
    };

    // Some basic contracts
    var contracts = {
        Undef: combinators.check(function(x) {
            return undefined === x;
        }, "Undefined"),
        Null : combinators.check(function(x) {
            return null === x;
        }, "Null"),
        Num: combinators.check(function(x) {
            return typeof(x) === "number";
        }, "Number"),
        Bool: combinators.check(function(x) {
            return typeof(x) === "boolean";
        }, "Boolean"),
        Str: combinators.check(function(x) {
            return typeof(x) === "string";
        }, "String"),
        Odd: combinators.check(function(x) {
            return  (x % 2) === 1;
        }, "Odd"),
        Even: combinators.check(function(x) {
            return (x % 2) === 1;
        }, "Even"),
        Pos: combinators.check(function(x) {
            return x >= 0;
        }, "Pos"),
        Arr: combinators.object({
            length: combinators.check(function(x) {
                return typeof(x) === "number";
            }, "Number")
        })
        // come back to these later...sort of want
        // to actively freeze the objects coming in
        // not just check that they have been frozen (maybe)

        // List: combinators.object({}, {
        //     frozen: true,
        //     noDelete: true,
        //     initPredicate: [Array.isArray, hasNoHoles]
        // }),
        // SaneArray: combinators.object({}, {
        //     frozen: false,
        //     noDelete: true,
        //     initPredicate: [Array.isArray, hasNoHoles]
        // }),
        // JsArray: combinators.object({}, {
        //     frozen: false,
        //     noDelete: false,
        //     initPredicate: Array.isArray
        // })
    };
    return {
        combinators: combinators,
        contracts: contracts
    };
})();
