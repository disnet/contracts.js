var Contracts = (function() {
    "use strict";

    var Utils = {
        // walk the proto chain to get the property descriptor
        getPropertyDescriptor : function getPropertyDescriptor(obj, prop) {
            var o = obj;
            do {
                var desc = Object.getOwnPropertyDescriptor(o, prop); 
                if (desc !== undefined) {
                    return desc;
                }
                o = Object.getPrototypeOf(o);
            } while(o !== null);
            return undefined;
        },

        // merges props of o2 into o1 return o1
        merge : function merge(o1, o2) {
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
        },

        hasNoHoles : function hasNoHoles(obj) {
            var i = 0;
            for( ; i < obj.length; i++) {
                if(!(i in obj))
                    return false;
            }
            return true;
        }
    };

    // Str -> \bot
    function _blame(toblame, msg, parents) {
        var err, st, ps = parents.slice(0);
        var m = "Contract violation: " + msg + "\n"
                + "Blame is on " + toblame + "\n";

        if(ps) {
            m += "Parent contracts:\n" + ps.reverse().join("\n");
        }

        err =  new Error(m);
        st = printStackTrace({e : err});
        err.message += "\n\n" + st.join("\n") ;

        throw err;
    }

    // [Str, Contract, any] -> \bot
    function blame(toblame, contract, value, parents) {
        var cname = contract.cname || contract;
        var msg = "expected <" + cname + ">"
                + ", actual: " + (typeof(value) === "string" ? '"' + value + '"' : value);

        throw _blame(toblame, msg, parents);
    }

    function blameM(toblame, msg, parents) {
        _blame(toblame, msg, parents);
    }

    // creeates an identity proxy handler
    function idHandler(obj) {
        return {
            getOwnPropertyDescriptor: function(name) {
                var desc = Object.getOwnPropertyDescriptor(obj, name);
                if (desc !== undefined) { desc.configurable = true; }
                return desc;
            },
            getPropertyDescriptor: function(name) {
                var desc = Utils.getPropertyDescriptor(obj, name);
                if(desc) {
                    desc.configurable = true;
                }
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
    function Contract(cname, ctype, handler) {
        this.handler = handler;
        this.cname = cname;
        this.ctype = ctype;
        this.parent = null;
    }
    Contract.prototype = {
        check : function check(val, pos, neg, parentKs) {
            return this.handler(val, pos, neg, parentKs);
        },
        toContract: function() {
            return this;  
        },
        toString: function() {
            return this.cname;
        }
    };
    Function.prototype.toContract = function() {
        return check(this, "<user defined contract>");
    };

    // (any -> Bool), [Str] -> Contract
    function check(p, name) {
        return new Contract(name, "flat", function check(val, pos, neg, parentKs) {
            if (p(val)) {
                return val;
            } else {
                blame(pos, this, val, parentKs);
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
    function fun(dom, rng, options) {
        var callOnly, newOnly, cleanDom, domName, optionsName, contractName,
            newdom, newrng, calldom, callrng;

        cleanDom = function(dom) {
            // wrap the domain in array so we can be consistent
            if (dom instanceof Contract) { 
                dom = [dom];
            }
            // don't allow required argument contracts to follow optional
            dom.reduce(function(prevWasOpt, curr) {
                if(curr.ctype === "opt") {
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

        domName = "(" + calldom.join(",") + ")";
        optionsName = (options.this ? "{this: " + options.this.cname + "}" : "");
        contractName = domName + " -> " + callrng.cname + " " + optionsName;

        return new Contract(contractName, "fun", function(f, pos, neg, parentKs) {
            var callHandler, newHandler,
                handler = idHandler(f),
                that = this,
                parents = parentKs.slice(0);

            if(typeof f !== "function") {
                blame(pos, this, f, parents); 
            }

            parents.push(that);

            // options:
            // { isNew: Bool   - make a constructor handler (to be called with new)
            //   newSafe: Bool - make call handler that adds a call to new
            //   pre: ({} -> Bool) - function to check preconditions
            //   post: ({} -> Bool) - function to check postconditions
            //   this: {...} - object contract to check 'this'
            // }
            var makeHandler = function(dom, rng, options) {
                return function functionHandler() {
                    var i, res,
                        args = [],
                        boundArgs, bf, thisc;

                    // check pre condition
                    if(typeof options.pre === "function") {
                        if(!options.pre(this)) {
                            blameM(neg, "failed precondition on: " + that, parents);  
                        }
                    }

                    // check all the arguments
                    for( i = 0; i < dom.length; i++) { 
                        // might pass through undefined which is fine (opt will take
                        // care of it if the argument is actually optional)
                        //
                        // blame is reversed
                        args[i] = dom[i].check(arguments[i], neg, pos, parents);
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
                        res = rng.check(res, pos, neg, parents);
                    } else {
                        if(options.this) {
                            // blame is reversed
                            thisc = options.this.check(this, neg, pos, parents);
                        } else {
                            thisc = this;
                        }
                        res = rng.check(f.apply(thisc, args), pos, neg, parents);
                    }

                    // check post condition
                    if(typeof options.post === "function") {
                        if(!options.post(this)) {
                            blameM(neg, "failed postcondition on: " + that, parents);  
                        }
                    }
                    return res;
                };
            };

            if(newOnly) {
                options.isNew = true;
                callHandler = function() {
                    blameM(neg, "called newOnly function without new", parents);
                };
                newHandler = makeHandler(newdom, newrng, options);
            } else if(callOnly) {
                options.isNew = false;
                newHandler = function() {
                    blameM(neg, "called callOnly function with a new", parents);
                };
                callHandler = makeHandler(calldom, callrng, options);
            } else { // both false...both true is a contract construction-time error and handled earlier
                callHandler = makeHandler(calldom, callrng, options);
                newHandler = makeHandler(newdom, newrng, options);
            }
            return Proxy.createFunction(handler, callHandler, newHandler);
        });
    };


    function ctor(dom, rng, options) {
        var opt = Utils.merge(options, {newOnly: true});
        return fun(dom, rng, opt);
    };

    function ctorSafe(dom, rng, options) {
        var opt = Utils.merge(options, {newSafe: true});
        return fun(dom, rng, opt);
    };

    function object(objContract, options) {
        options = options || {};

        var objName = function(obj) {
            var props = Object.keys(obj).map(function(propName) {
                if(obj[propName].cname) {
                    return propName + " : " + obj[propName].cname;
                } else {
                    return propName + " : " + obj[propName].value.cname;
                }
            }, this);
            return "{" + props.join(", ") + "}";
        };

        var c = new Contract(objName(objContract), "object", function(obj, pos, neg, parentKs) {
            var missingProps, op, i, prop, contractDesc, objDesc, value,
                handler = idHandler(obj);
            var that = this;
            var parents = parentKs.slice(0);
            parents.push(this);

            if(!(obj instanceof Object)) {
                blame(pos, this, obj, parentKs);
            }
            if(options.extensible === true && !Object.isExtensible(obj)) {
                blame(pos, "[extensible object]", "[non-extensible object]", parents);
            }
            if(options.extensible === false && Object.isExtensible(obj)) {
                blame(pos, "[non-extensible]", "[extensible object]", parents);
            }
            if(options.sealed === true && !Object.isSealed(obj)) {
                blame(pos, "[sealed object]", "[non-sealed object]", parents);
            }
            if(options.sealed === false && Object.isSealed(obj)) {
                blame(pos, "[non-sealed object]", "[sealed object]", parents);
            }
            if(options.frozen === true && !Object.isFrozen(obj)) {
                blame(pos, "[frozen object]", "[non-frozen object]", parents);
            }
            if(options.frozen === false && Object.isFrozen(obj)) {
                blame(pos, "[non-frozen object]", "[frozen object]", parents);
            }

            // do some cleaning of the object contract...
            // in particular wrap all object contract in a prop descriptor like object
            // for symmetry with user defined contract property
            // descriptors: object({ a: Num }) ==> object({ a: {value: Num} })
            for(prop in this.oc) {
                // todo: commenting out for now to allow us to have an object contract prototype chain
                // only reason not too allow this is if the user puts something silly on the chain. 
                // if(!this.oc.hasOwnProperty(prop)) {
                //     continue; 
                // }

                contractDesc = this.oc[prop];
                objDesc = Utils.getPropertyDescriptor(obj, prop);

                // pull out the contract (might be direct or in a descriptor like {value: Str, writable: true})
                if(contractDesc instanceof Contract) {
                    value = contractDesc;
                } else {
                    // case when defined as a contract property descriptor
                    if(contractDesc.value) {
                        value = contractDesc.value;
                    } else {
                        // something other than a descriptor
                        blameM(pos, "contract property descriptor missing value property", parents);
                    }
                }

                if(objDesc) {
                    // check the contract descriptors agains what is actually on the object
                    // and blame where apropriate
                    if(contractDesc.writable === true && !objDesc.writable) {
                        blame(pos, "[writable property: " + prop + "]", "[read-only property: " + prop + "]", parents);
                    }
                    if (contractDesc.writable === false && objDesc.writable) {
                        blame(pos, "[read-only property: " + prop + "]", "[writable property: " + prop + "]", parents);
                    }
                    if(contractDesc.configurable === true && !objDesc.configurable) {
                        blame(pos, "[configurable property: " + prop + "]", "[non-configurable property: " + prop + "]", parents);
                    }
                    if(contractDesc.configurable === false && objDesc.configurable) {
                        blame(pos, "[non-configurable property: " + prop + "]", "[configurable property: " + prop + "]", parents);
                    }
                    if(contractDesc.enumerable === true && !objDesc.enumerable) {
                        blame(pos, "[enumerable property: " + prop + "]", "[non-enumerable property: " + prop + "]", parents);
                    }
                    if(contractDesc.enumerable === false && objDesc.enumerable) {
                        blame(pos, "[non-enumerable property: " + prop + "]", "[enumerable property: " + prop + "]", parents);
                    }

                    // contract descriptors default to the descriptor on the value unless
                    // explicitly specified by the contrac 
                    this.oc[prop] = {
                        value        : value,
                        writable     : contractDesc.writable || objDesc.writable,
                        configurable : contractDesc.configurable || objDesc.configurable,
                        enumerable   : contractDesc.enumerable || objDesc.enumerable
                    };
                } else { // property does not exist but we have a contract for it
                    if(value.ctype === "opt") { // the opt contract allows a property to be optional
                        this.oc[prop] = {       // so just put in the contract with all the prop descriptors set to true
                            value        : value,
                            writable     : true,
                            configurable : true,
                            enumerable   : true
                        };
                    } else {
                        blame(pos, this, "[missing property: " + prop + "]", parents);
                    }
                }
            }

            handler.defineProperty = function(name, desc) {
                // note: we coulad have also allowed a TypeError to be thrown by the system
                // if in strict mode or silengtly fail otherwise but we're using the blame system
                // for hopfully better error messaging
                if((options.extensible === false) || options.sealed || options.frozen) {
                    // have to reverse blame since the client is the one calling defineProperty
                    blame(neg,
                          "[non-extensible object]",
                          "[attempted to change property descriptor of: " + name + "]",
                          parents);
                }
                if(!that.oc[name].configurable) {
                    blame(neg,
                          "[non-configurable property: " + name + "]",
                          "[attempted to change the property descriptor of property: " + name + "]",
                          parents);
                }
                Object.defineProperty(obj, name, desc);
            };
            handler.delete = function(name) {
                if(options.sealed || options.frozen) {
                    // have to reverse blame since the client is the one calling delete
                    blame(neg, (options.sealed ? "sealed" : "frozen") + " object", "[call to delete]", parents);
                }
                return delete obj[name]; 
            };
            handler.get = function(receiver, name) {
                if(that.oc.hasOwnProperty(name)) { 
                    return that.oc[name].value.check(obj[name], pos, neg, parents);
                } else if ( (options.arrayRangeContract && (options.arrayRange !== undefined))
                            && (parseInt(name, 10) >= options.arrayRange) ) {
                    return options.arrayRangeContract.check(obj[name], pos, neg, parents);
                } else {
                    return obj[name];
                }
            };
            handler.set = function(receiver, name, val) {
                if( (options.extensible === false) && Object.getOwnPropertyDescriptor(obj, name) === undefined) {
                    blame(neg, "non-extensible object", "[attempted to set a new property: " + name + "]", parents);
                }
                if(options.frozen) {
                    blame(neg, "frozen object", "[attempted to set: " + name + "]", parents);
                }
                if(that.oc.hasOwnProperty(name)) { 
                    if(!that.oc[name].writable) {
                        blame(neg, "read-only property", "[attempted to set read-only property: " + name + "]", parents);
                    }
                    // have to reverse blame since the client is the one calling set
                    obj[name] = that.oc[name].value.check(val, neg, pos, parents);
                } else if ( (options.arrayRangeContract && (options.arrayRange !== undefined))
                            && (parseInt(name, 10) >= options.arrayRange) ) {
                    obj[name] = options.arrayRangeContract.check(val, neg, pos, parents);
                } else {
                    obj[name] = val;
                }
                return true;
            };

            // making this a function proxy if object is also a
            // function to preserve typeof checks
            if (typeof obj === "function") {
                op = Proxy.createFunction(handler,
                                          function(args) {
                                              return obj.apply(this, arguments);
                                          },
                                          function(args) {
                                              var boundArgs, bf;
                                              boundArgs = [].concat.apply([null], arguments);
                                              bf = obj.bind.apply(obj, boundArgs);
                                              return new bf();
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

    // (___(any), () -> Contract) -> Contract
    function arr(ks) {
        // todo might make sens to allow var args along with array arguments
        var i, rangeContract, rangeIndex, oc = {};
        for(i = 0; i < ks.length; i++) {
            // assuming that the only possible function is ___()
            if(typeof ks[i] === "function") {
                if(i !== ks.length - 1) {
                    throw "___() must be at the last position in the array";
                }
                rangeContract = ks[i]();
                rangeIndex = i;
            } else {
                oc[i] = ks[i];
            }
        }
        return object(oc, {arrayRange: rangeIndex, arrayRangeContract: rangeContract});
    };

    function ___(k) {
        return function() {
            return k;
        };
    };

    var any = (function any() {
        return new Contract("any", "any", function(val) {
            return val;
        });
    })();

    function or() {
        var ks, name;
        ks = [].slice.call(arguments);
        ks.forEach(function(el) {
            if(el.ctype === "fun" || el.ctype === "object") {
                throw "cannot construct an 'or' contract with a function or object contract";
            }
        });

        name = ks.join(" or ");
        return new Contract(name, "or",  function(val, pos, neg, parentKs) {
            var i, lastBlame,
                parents = parentKs.slice(0);
            parents.push(this);
            
            for(i = 0; i < ks.length; i++) {
                try {
                    return ks[i].check(val, pos, neg, parents);
                } catch (e) {
                    lastBlame = e;
                    continue;
                }
            }
            throw lastBlame; // the last contract in the array still assigned blame so surface it
        });
    };
    
    var none = (function none() {
        return new Contract("none", "none",  function(val, pos, neg, parentKs) {
            blame(pos, this, val, parentKs);
        });
    })();

    function and(k1, k2) {
        return new Contract(k1.cname + " and " + k2.cname, "and", function(val, pos, neg, parentKs) {
            var k1c = k1.check(val, pos, neg, parentKs);
            return k2.check(k1c, pos, neg, parentKs);
        });
    };

    function opt(k) {
        return new Contract("opt(" + k.cname + ")", "opt", function(val, pos, neg, parentKs) {
            if(val === undefined) { // unsuplied arguments are just passed through
                return val;
            } else {
                // arg is actually something so check the underlying contract
                return k.check(val, pos, neg, parentKs);
            }
        });
    };

    function guard(k, x, pos, neg) {
        var guardedAt;
        if(!pos) {
            guardedAt = printStackTrace({e: new Error()})[1];
            if(typeof x === "function" && x.name !== "") {
                pos = "function '" + x.name + "' guarded at: " + guardedAt;
            } else {
                pos = "value guarded at: " + guardedAt;
            }
            neg = "client of " + pos;
        }
        if(pos && !neg) {
            neg = "client of " + pos;
        }
        // k.setGuardSite(guardedAt);
        return k.check(x, pos, neg, []);
    };

    var combinators = {
        check: check,
        fun: fun,
        ctor: ctor,
        ctorSafe: ctorSafe,
        object: object,
        arr: arr,
        ___: ___,
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
            return (x % 2) !== 1;
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
