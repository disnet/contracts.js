/*global module:false*/
module.exports = function(grunt) {

    var path = require("path");
    var exec = require("child_process").exec;

    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-sweet.js');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-template');
    grunt.loadNpmTasks('grunt-benchmark');


    // Project configuration.
    grunt.initConfig({
        // Task configuration.
        sweetjs: {
            contracts: {
                options: {
                    readableNames: true,
                    modules: ["sparkler/macros", "es6-macros", "./src/helper-macros.js"]
                },
                src: "src/contracts.js",
                dest: "build/contracts.js"
            },
            tests: {
                options: {
                    readableNames: true,
                    modules: ["./macros/index.js"]
                },
                src: "test/test_contracts.js",
                dest: "build/tests/test_contracts.js"
            },
            benchmark: {
                options: {
                    readableNames: true,
                    modules: ["./macros/index.js"]
                },
                src: "benchmark/src/*.js",
                dest: "benchmark/"
            }
        },
        template: {
            macros: {
                options: {
                    data: function() {
                        return {
                            lib: grunt.file.read("build/contracts.js")
                        };
                    }
                },
                src: "src/macros.js",
                dest: "build/macros/index.js"
            },
            diabledMacros: {
                options: {
                    data: function() {
                        return {
                            lib: grunt.file.read("build/contracts.js")
                        };
                    }
                },
                src: "src/macros-disabled.js",
                dest: "build/macros/disabled.js"
            },
            webpage: {
                options: {
                    data: function() {
                        return {
                            tutorial: grunt.file.read("build/tutorial.html"),
                            reference: grunt.file.read("build/contracts.html")
                        };
                    }
                },
                src: "webpage/index.html",
                dest: "./index.html"
            },
        },
        copy: {
            macros: {
                expand: true,
                flatten: true,
                src: "build/macros/*",
                dest: "macros/"
            }
        },
        jshint: {
            options: {
                curly: true,
                eqeqeq: true,
                immed: true,
                latedef: true,
                newcap: true,
                noarg: true,
                sub: true,
                undef: true,
                unused: true,
                boss: true,
                eqnull: true,
                globals: {
                    jQuery: true
                }
            },
            gruntfile: {
                src: 'Gruntfile.js'
            },
            lib_test: {
                src: ['contracts.js', 'test/**/*.js']
            }
        },
        benchmark: {
            all: {
                src: ["benchmark/*.js"],
                dest: "benchmark/results.csv"
            }
        },
        pandoc: {
            reference: {
                options: {
                    pandocOptions: ["--to=html5", "--template=webpage/bootstrap-template.html", "--toc", "--number-section"]
                },
                src: "doc/main/contracts.md",
                dest: "build/contracts.html"
            },
            standaloneReference: {
                options: {
                    pandocOptions: ["--to=html5",
                                    "--standalone",
                                    "--toc",
                                    "--number-sections",
                                    "--include-in-header=doc/main/style/main.css"]
                },
                src: "doc/main/contracts.md",
                dest: "doc/main/contracts.html"
            },
            tutorial: {
                options: {
                    pandocOptions: ["--to=html5"]
                },
                src: "tutorial.md",
                dest: "build/tutorial.html"
            }
        },
        mochaTest: {
            contracts: {
                src: ["build/tests/*.js"]
            }
        },
        watch: {
            scripts: {
                files: ["src/*", "test/*"],
                tasks: ["sweetjs:contracts", "template", "sweetjs:tests", "mochaTest"]
            },
            docs: {
                files: ["doc/main/*"],
                tasks: ["docs"]
            }
        }
    });


    grunt.registerMultiTask("pandoc", function() {
        var cb = this.async();
        var options = this.options({});
        var pandocOpts = options.pandocOptions.join(" ");
        this.files.forEach(function(f) {
            f.src.forEach(function(file) {
                var args = ["-o " + f.dest].concat(pandocOpts.slice())
                                          .concat(file);
                exec("pandoc " + args.join(" "), cb);
            });
        });
    });


    // Default task.
    grunt.registerTask('default', ["sweetjs:contracts", "template:macros", "template:diabledMacros", "copy", "sweetjs:tests", "mochaTest"]);

    grunt.registerTask("bench", ["sweetjs:benchmark", "benchmark"]);

    grunt.registerTask("docs", ["pandoc", "template:webpage"]);

};
