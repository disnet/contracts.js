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

macro toLibrary {
    // function
    rule { {
		($args ...) -> $rest ...
	} } => {
        _c.fun(
            [toLibrary { $args ... }],
             toLibrary {$rest ...})
    }

    // object
    rule { {
        { $($key $[:] $contract ...) (,) ... }
    } } => {
        _c.object({
            $($key $[:] toLibrary { $contract ...}) (,) ...
        })

    }

    // proxied object
    rule { {
        !{ $($key $[:] $contract ...) (,) ... }
    } } => {
        _c.object({
            $($key $[:] toLibrary { $contract ...}) (,) ...
        }, {proxy: true})

    }

    // array
    rule { {
        [ $contracts ... ]
    } } => {
        _c.array([toLibrary { $contracts ...} ])

    }

    // proxied array
    rule { {
        ![ $contracts ... ]
    } } => {
        _c.array([toLibrary { $contracts ...} ], {proxy: true})

    }

    rule { {
        $contract ... , $rest ...
	} } => {
        toLibrary { $contract ... } , toLibrary { $rest ... }
    }

    rule { {
        $[...] $contract ...
    } } => {
        _c.repeat(toLibrary { $contract ... })
    }

    rule { {
		$contract
	} } => {
        _c.$contract
	}
}



let @ = macro {
	case {_
        $contracts ...
		function $name ($params ...) { $body ...}
    } => {
        var nameStr = unwrapSyntax(#{$name});
        letstx $guardedName = [makeIdent("inner_" + nameStr, #{here})];
        letstx $client = [makeValue("function " + nameStr, #{here})];
        letstx $server = [makeValue("(calling context for " + nameStr + ")", #{here})];
        letstx $fnName = [makeValue(nameStr, #{here})];
		return #{
            var $guardedName = (toLibrary { $contracts ... }).proj(_c.Blame.create($fnName, $client, $server))(function $name ($params ...) { $body ...});
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
	}
}
export @;
