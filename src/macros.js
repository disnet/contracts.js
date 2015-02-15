var _c;
let import = macro {
    rule { @ from $lib:lit } => {
        _c = <%= lib %>
    }
    rule { $rest ... } => {
        import $rest ...
    }
}
export import;

macro stringify {
    case {_ ($toks ...) } => {
        var toks = #{$toks ...}[0].token.inner;

        function traverse(stx) {
            return stx.map(function(s) {
                if (s.token.inner) {
                    return s.token.value[0] + traverse(s.token.inner) + s.token.value[1];
                }
                return s.token.value;
            }).join(" ");
        }

        var toksStr = traverse(toks);
        letstx $str = [makeValue(toksStr, #{here})];
        return #{$str}
    }
}

macro base_contract {
    rule { $name } => { typeof $name !== 'undefined' ? $name : _c.$name }
}

macroclass named_contract {
    rule { $name $[:] $contract:any_contract }
}

macro function_contract {
    rule { ($dom:named_contract (,) ...) this $this:object_contract -> $range:named_contract | { $guard ... } } => {
        _c.fun([$dom$contract (,) ...], $range$contract, {
            dependency: function($dom$name (,) ..., $range$name) {
                $guard ...
            },
            thisContract: $this,
            namesStr: [$(stringify (($dom$name))) (,) ..., stringify (($range$name))],
            dependencyStr: stringify (($guard ...))
        })
    }
    rule { ($dom:named_contract (,) ...) -> $range:named_contract | { $guard ... } } => {
        _c.fun([$dom$contract (,) ...], $range$contract, {
            dependency: function($dom$name (,) ..., $range$name) {
                $guard ...
            },
            namesStr: [$(stringify (($dom$name))) (,) ..., stringify (($range$name))],
            dependencyStr: stringify (($guard ...))
        })
    }
    rule { ($dom:named_contract (,) ...) this $this:object_contract -> $range:named_contract | $guard:expr } => {
        _c.fun([$dom$contract (,) ...], $range$contract, {
            dependency: function($dom$name (,) ..., $range$name) {
                return $guard;
            },
            thisContract: $this,
            namesStr: [$(stringify (($dom$name))) (,) ..., stringify (($range$name))],
            dependencyStr: stringify ($guard)
        })
    }
    rule { ($dom:named_contract (,) ...) -> $range:named_contract | $guard:expr } => {
        _c.fun([$dom$contract (,) ...], $range$contract, {
            dependency: function($dom$name (,) ..., $range$name) {
                return $guard;
            },
            namesStr: [$(stringify (($dom$name))) (,) ..., stringify (($range$name))],
            dependencyStr: stringify ($guard)
        })
    }
    rule { ($dom:any_contract (,) ...) -> $range:any_contract | this $[:] $this:object_contract } => {
        _c.fun([$dom (,) ...], $range, {
            thisContract: $this
        })
    }
    rule { ($dom:any_contract (,) ...) -> $range:any_contract } => {
        _c.fun([$dom (,) ...], $range)
    }
    // async
    rule { async ($dom:any_contract (,) ...) -> $range:any_contract } => {
        _c.async([$dom (,) ...], $range)
    }
    // once
    rule { once ($dom:any_contract (,) ...) -> $range:any_contract } => {
        _c.once([$dom (,) ...], $range)
    }
}

macro object_contract {
    rule { {
        $($prop $[:] $contract:any_contract) (,) ...
    } } => {
        _c.object({
            $($prop : $contract) (,) ...
        })
    }
    // proxied objects
    rule { !{
        $($prop $[:] $contract:any_contract) (,) ...
    } } => {
        _c.object({
            $($prop : $contract) (,) ...
        }, {proxy: true})
    }
}

macro array_contract {
    rule { [
        $contracts:any_contract (,) ...
    ] } => {
        _c.array([$contracts (,) ...])
    }
    // proxied arrays
    rule { ![
        $contracts:any_contract (,) ...
    ] } => {
        _c.array([$contracts (,) ...], {proxy: true})
    }
}

macro repeat_contract {
    rule {$[...] $contract:any_contract } => {
        _c.repeat($contract)
    }
}

macro optional_contract {
    rule {
        ? $contract:any_contract
    } => {
        _c.optional($contract)
    }
}

macro predicate_contract {
    rule {
        ($param) => { $pred ... }
    } => {
        _c.check(function($param) { $pred ... }, stringify (($pred ...)) )
    }

    rule {
        ($param) => $pred:expr
    } => {
        _c.check(function($param) { return $pred; }, stringify ($pred) )
    }
}

macro regex {
    case {_ $tok } => {
        var tok = #{$tok};
        if (tok[0].token.type === parser.Token.RegularExpression) {
            return tok;
        }
        throwSyntaxCaseError("Not a regular expression");
    }
}

macro regex_contract {
    rule { $re:regex } => {
        _c.reMatch($re)
    }
}


macro non_bin_contract {
    rule { $contract:regex_contract }     => { $contract }
    rule { $contract:predicate_contract } => { $contract }
    rule { $contract:function_contract }  => { $contract }
    rule { $contract:object_contract }    => { $contract }
    rule { $contract:array_contract }     => { $contract }
    rule { $contract:repeat_contract }    => { $contract }
    rule { $contract:optional_contract }  => { $contract }
    rule { $contract:base_contract }      => { $contract }
}

macro or_contract {
    rule { $left:non_bin_contract or $right:any_contract } => {
        _c.or($left, $right)
    }
}

macro and_contract {
    rule { $left:non_bin_contract and $right:any_contract } => {
        _c.and($left, $right)
    }
}

macro any_contract {
    rule { $contract:or_contract }     => { $contract }
    rule { $contract:and_contract }     => { $contract }
    rule { $contract:non_bin_contract } => { $contract }
}


let @ = macro {
    // special casing let bound predicate contracts to get the name
    // from the let binding instead of doing stringify to the predicate body
    case {_
         let $contractName = ($param) => { $pred ... }
    } => {
        return #{
            _c.$contractName = _c.check(function($param) { $pred ...},
                                        stringify (($contractName)))
        }
    }
    case {_
         let $contractName = ($param) => $pred:expr
    } => {
        return #{
            _c.$contractName = _c.check(function($param) { return $pred },
                                        stringify (($contractName)))
        }
    }
    case {_
          let $contractName = $contract:any_contract
    } => {
        return #{
            _c.$contractName = _c.cyclic(stringify (($contractName)));
            _c.$contractName = _c.$contractName.closeCycle($contract);
        }
    }

    case {_
        forall $($varName (,) ...)
        $contracts:function_contract
        function $name ($params ...) { $body ...}
    } => {
        var nameStx = #{$name}[0];
        var nameStr = unwrapSyntax(nameStx);
        var varNameStr = #{$varName ...}.map(function(stx) {
            return makeValue(stx.token.value, #{here});
        });
        letstx $guardedName = [makeIdent("inner$" + nameStr, #{here})];
        letstx $client = [makeValue("function " + nameStr, #{here})];
        letstx $server = [makeValue("(calling context for " + nameStr + ")", #{here})];
        letstx $fnName = [makeValue(nameStr, #{here})];
        letstx $lineNumber = [makeValue(nameStx.token.sm_lineNumber, #{here})];
        letstx $varNameStr ... = varNameStr;
        return #{
            $(_c.$varName = _c.makeCoffer($varNameStr)) (,) ...;
            var $guardedName = ($contracts).proj(_c.Blame.create($fnName, $client, $server, $lineNumber))(function $name ($params ...) { $body ...});
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
    }

	case {_
        $contracts:function_contract
		function $name ($params ...) { $body ...}
    } => {
        var nameStx = #{$name}[0];
        var nameStr = unwrapSyntax(nameStx);
        letstx $guardedName = [makeIdent("inner$" + nameStr, #{here})];
        letstx $client = [makeValue("function " + nameStr, #{here})];
        letstx $server = [makeValue("(calling context for " + nameStr + ")", #{here})];
        letstx $fnName = [makeValue(nameStr, #{here})];
        letstx $lineNumber = [makeValue(nameStx.token.sm_lineNumber, #{here})];
        letstx $fresh = [makeValue(__fresh(), #{here})];
		return #{
            var $guardedName = ($contracts).proj(_c.Blame.create($fnName, $client, $server, $lineNumber))(function $name ($params ...) { $body ...});
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
	}
}
export @;
