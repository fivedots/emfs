// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

mergeInto(LibraryManager.library, {
  $NATIVEIOFS__deps: ['$ERRNO_CODES', '$FS', '$MEMFS', '$NODEFS'],
  $NATIVEIOFS__postset: '' +
      'if (typeof io !== "undefined") {' +
      'console.log("IO", io);' +
      '}',
  $NATIVEIOFS: {

    /* Debugging */

    debug: function(...args) {
      // Uncomment to print debug information.
      //
      //console.log('nativeiofs', arguments);
    },

    /* Profiling */

    profileData: {},

    profileMetric: function(name, value) {
      if (name in NATIVEIOFS.profileData) {
        NATIVEIOFS.profileData[name].value += value;
        NATIVEIOFS.profileData[name].count++;
      } else {
        NATIVEIOFS.profileData[name] = {
          value: value,
          count: 1,
        }
      }
    },

    profile: function(name, fn) {
      var start = performance.now();
      var result = fn();
      var value = performance.now() - start;
      NATIVEIOFS.profileMetric(name, value);
      return result;
    },

    /* Helper functions */

    realPath: function(node) {
      var parts = [];
      while (node.parent !== node) {
        parts.push(node.name);
        node = node.parent;
      }
      if (!parts.length) {
        return '_';
      }
      parts.push('');
      parts.reverse();
      return parts.join('_');
    },

    baseName: function(path) {
      return path.split('_').pop();
    },

    joinPaths: function(path1, path2) {
      if (path1.endsWith('_')) {
        if (path2.startsWith('_')) {
          return path1.slice(0, -1) + path2;
        }
        return path1 + path2;
      } else {
        if (path2.startsWith('_')) {
          return path1 + path2;
        }
        return path1 + '_' + path2;
      }
    },

    // directoryPath ensures path ends with a path delimiter ('_').
    //
    // Example:
    // * directoryPath('_dir') = '_dir_'
    // * directoryPath('_dir_') = '_dir_'
    directoryPath: function(path) {
      if (path.length && path.slice(-1) == '_') {
        return path;
      }
      return path + '_';
    },

    // extractFilename strips the parent path and drops suffixes after '_'.
    //
    // Example:
    // * extractFilename('_dir', '_dir_myfile') = 'myfile'
    // * extractFilename('_dir', '_dir_mydir_myfile') = 'mydir'
    extractFilename: function(parent, path) {
      parent = NATIVEIOFS.directoryPath(parent);
      path = path.substr(parent.length);
      var index = path.indexOf('_');
      if (index == -1) {
        return path;
      }
      return path.substr(0, index);
    },

    /* Filesystem implementation (public interface) */

    createNode: function (parent, name, mode, dev) {
      NATIVEIOFS.debug('createNode', arguments);
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      var node = FS.createNode(parent, name, mode);
      node.node_ops = NATIVEIOFS.node_ops;
      node.stream_ops = NATIVEIOFS.stream_ops;
      if (FS.isDir(mode)) {
        node.contents = {};
      }
      return node;
    },

    mount: function (mount) {
      NATIVEIOFS.debug('mount', arguments);
      return NATIVEIOFS.createNode(null, '/', {{{ cDefine('S_IFDIR') }}} | 511 /* 0777 */, 0);
    },

    cwd: function() { return process.cwd(); },

    chdir: function() { process.chdir.apply(void 0, arguments); },

    allocate: function() {
      NATIVEIOFS.debug('allocate', arguments);
      throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
    },

    ioctl: function() {
      NATIVEIOFS.debug('ioctl', arguments);
      throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
    },

    /* Operations on the nodes of the filesystem tree */

    node_ops: {
      getattr: function(node) {
        NATIVEIOFS.debug('getattr', arguments);
        return NATIVEIOFS.profile('getattr', function() {
          var attributes = null;
          if (node.handle) {
            attributes = node.handle.getAttributes();
          } else {
            try {
              var path = NATIVEIOFS.realPath(node);
              var handle = io.openFile(path);
              attributes = handle.getAttributes();
            } catch (e) {
              if (!('code' in e)) throw e;
              throw new FS.ErrnoError(-e.errno);
            } finally {
              if (handle) {
                handle.close();
              }
            }
          }
          var modificationTime = new Date();
          return {
            dev: null,
            ino: null,
            mode: node.mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: null,
            size: attributes.size,
            atime: modificationTime,
            mtime: modificationTime,
            ctime: modificationTime,
            blksize: 4096,
            blocks: (attributes.size+4096-1)/4096|0,
          };
        });
      },

      setattr: function(node, attr) {
        NATIVEIOFS.debug('setattr', arguments);
	NATIVEIOFS.profile('setattr', function() {
          if ('size' in attr) {
            try {
              var open = false;
              var handle = null;
              if (node.handle) {
                open = false;
                handle = node.handle;
              } else {
                open = true;
                handle = io.openFile(NATIVEIOFS.realPath(node));
              }
	      var attributes = { size: attr.size };
              handle.setAttributes(attributes);
            } catch (e) {
              if (!('code' in e)) throw e;
              throw new FS.ErrnoError(-e.errno);
            } finally {
              if (open && handle) {
                handle.close();
              }
            }
          }
	});
      },

      lookup: function (parent, name) {
        NATIVEIOFS.debug('lookup', arguments);
        return NATIVEIOFS.profile('lookup', function() {
          var parentPath = NATIVEIOFS.directoryPath(NATIVEIOFS.realPath(parent));

	  var children = io.listByPrefix(parentPath);

          var exists = false;
          var mode = 511 /* 0777 */
          for (var i = 0; i < children.length; ++i) {
            var path = children[i].substr(parentPath.length);
            if (path == name) {
              exists = true;
              mode |= {{{ cDefine('S_IFREG') }}};
              break;
            }

            subdirName = NATIVEIOFS.directoryPath(name);
            if (path.startsWith(subdirName)) {
              exists = true;
              mode |= {{{ cDefine('S_IFDIR') }}};
              break;
            }
          }

          if (!exists) {
            throw FS.genericErrors[{{{ cDefine('ENOENT') }}}];
          }

          var node = FS.createNode(parent, name, mode);
          node.node_ops = NATIVEIOFS.node_ops;
          node.stream_ops = NATIVEIOFS.stream_ops;
          return node;
        });
      },

      mknod: function (parent, name, mode, dev) {
        NATIVEIOFS.debug('mknod', arguments);
	return NATIVEIOFS.profile('mknod', function() {
          var node = NATIVEIOFS.createNode(parent, name, mode, dev);
          try {
            if (FS.isFile(mode)) {
              var path = NATIVEIOFS.realPath(node);
              io.createFile(path);

              node.handle = null;
              node.refcount = 0;
            }
          } catch (e) {
            if (!('code' in e)) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
          return node;
	});
      },

      rename: function (oldNode, newParentNode, newName) {
        NATIVEIOFS.debug('rename', arguments);
	NATIVEIOFS.profile('rename', function() {
          if (oldNode.isFolder) {
            // Only file renames are supported for now
            throw new FS.ErrnoError(ERRNO_CODES.EPERM);
          }

          var oldPath = NATIVEIOFS.realPath(oldNode);
          var newPath = NATIVEIOFS.joinPaths(NATIVEIOFS.realPath(newParentNode), newName);
          try {
            io.rename(oldPath, newPath);
          } catch (e) {
            if (!('code' in e)) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
	});
      },

      unlink: function(parent, name) {
        NATIVEIOFS.debug('unlink', arguments);
	NATIVEIOFS.profile('unlink', function() {
          var path = NATIVEIOFS.joinPaths(NATIVEIOFS.realPath(parent), name);
          io.unlink(path);
        });
      },

      rmdir: function(parent, name) {
        NATIVEIOFS.debug('rmdir', arguments);
        NATIVEIOFS.profile('rmdir', function() {
          MEMFS.rmddir(parent, name);
        });
      },

      readdir: function(node) {
        NATIVEIOFS.debug('readdir', arguments);
	return NATIVEIOFS.profile('readdir', function() {
	  var parentPath = NATIVEIOFS.realPath(node);
          var children = io.listByPrefix(parentPath);
          children = children.map(child => NATIVEIOFS.extractFilename(parentPath, child));
          // Remove duplicates.
          return Array.from(new Set(children));
	});
      },

      symlink: function(parent, newName, oldPath) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      },

      readlink: function(node) {
	// readlink(2) does not seem to have an errno for operation not
	// supported. Since NativeIO FS does not support symlinks, return EINVAL
	// for file not being a symlink.
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      },
    },

    /* Operations on file streams (i.e., file handles) */

    stream_ops: {
      open: function (stream) {
        NATIVEIOFS.debug('open', arguments);
        NATIVEIOFS.profile('open', function() {
          try {
            if (FS.isFile(stream.node.mode)) {
              if (stream.node.handle) {
                stream.handle = stream.node.handle;
                ++stream.node.refcount;
              } else {
                var path = NATIVEIOFS.realPath(stream.node);

                // Open existing file.
                stream.handle = io.openFile(path);
                stream.node.handle = stream.handle;
                stream.node.refcount = 1;
              }
            }
          } catch (e) {
            if (!('code' in e)) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        });
      },

      close: function (stream) {
        NATIVEIOFS.debug('close', arguments);
        NATIVEIOFS.profile('close', function() {
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.handle = null;
              --stream.node.refcount;
              if (stream.node.refcount <= 0) {
                stream.node.handle.close();
                stream.node.handle = null;
              }
            }
          } catch (e) {
            if (!('code' in e)) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        });
      },

      fsync: function(stream) {
        NATIVEIOFS.debug('fsync', arguments);
        return NATIVEIOFS.profile('fsync', function() {
          if (stream.handle == null) {
            return ERRNO_CODES.EBADF;
          }

          stream.handle.sync();
          return 0;
        });
      },

      // TODO(jabolopes): Switch read to the new interface.
      read: function (stream, buffer, offset, length, position) {
        NATIVEIOFS.debug('read', arguments);
        return NATIVEIOFS.profile('read', function() {
          var data = buffer.subarray(offset, offset + length);
          var bytesRead = stream.handle.read(data, position);
          buffer.set(data, offset);
          return bytesRead;
        });
      },

      write: function (stream, buffer, offset, length, position) {
        NATIVEIOFS.debug('write', arguments);
        return NATIVEIOFS.profile('write', function() {
          var data = buffer.subarray(offset, offset + length);
          return stream.handle.write(data, position);
        });
      },

      llseek: function (stream, offset, whence) {
        NATIVEIOFS.debug('llseek', arguments);
        return NATIVEIOFS.profile('llseek', function() {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            position += stream.handle.getAttributes().size;
          } else if (whence !== 0) {  // SEEK_SET.
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }

          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          stream.position = position;
          return position;
        });
      },

      mmap: function(stream, buffer, offset, length, position, prot, flags) {
        NATIVEIOFS.debug('mmap', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },

      msync: function(stream, buffer, offset, length, mmapFlags) {
        NATIVEIOFS.debug('msync', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },

      munmap: function(stream) {
        NATIVEIOFS.debug('munmap', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },
    }
  }
});
