// Copyright 2019 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

mergeInto(LibraryManager.library, {
  $IOFS__deps: ['$ERRNO_CODES', '$FS', '$MEMFS', '$NODEFS'],
  $IOFS__postset: '' +
      'if (typeof webkitRequestFileSystemSync !== "undefined") {' +
      'var VFS = webkitRequestFileSystemSync(TEMPORARY, 1024*1024*10);' +
      'console.log("VFS", VFS);' +
      '}',
  $IOFS: {
    debug: function(...args) {
      // Uncomment to print debug information.
      //
      // console.log('iofs', arguments);
    },

    profileData: {},

    profileMetric: function(name, value) {
      if (name in IOFS.profileData) {
        IOFS.profileData[name].value += value;
        IOFS.profileData[name].count++;
      } else {
        IOFS.profileData[name] = {
          value: value,
          count: 1,
        }
      }
    },

    profile: function(name, fn) {
      var start = performance.now();
      var result = fn();
      var value = performance.now() - start;
      IOFS.profileMetric(name, value);
      return result;
    },

    mount: function (mount) {
      IOFS.debug('mount', arguments);
      return IOFS.createNode(null, '/', {{{ cDefine('S_IFDIR') }}} | 511 /* 0777 */, 0);
    },
    realPath: function(node) {
      // Computes the real path and replaces '/' with '_' because the low-level
      // IO API doesn't know what directories are and does not allow '/'.
      return NODEFS.realPath(node).replace(/\//g, '_');
    },
    realPathName: function(path) {
      return path.split('_').pop();
    },
    joinPaths: function(...paths) {
      return paths.join("_");
    },
    createNode: function (parent, name, mode, dev) {
      IOFS.debug('createNode', arguments);
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError({{{ cDefine('EINVAL') }}});
      }
      var node = FS.createNode(parent, name, mode);
      node.node_ops = IOFS.node_ops;
      node.stream_ops = IOFS.stream_ops;
      if (FS.isDir(mode)) {
        node.contents = {};
      }
      return node;
    },
    cwd: function() { return process.cwd(); },
    chdir: function() { process.chdir.apply(void 0, arguments); },
    chmod: function() { fs.chmodSync.apply(void 0, arguments); },
    fchmod: function() { fs.fchmodSync.apply(void 0, arguments); },
    chown: function() { fs.chownSync.apply(void 0, arguments); },
    fchown: function() { fs.fchownSync.apply(void 0, arguments); },
    utime: function() { fs.utimesSync.apply(void 0, arguments); },
    allocate: function() {
      throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
    },
    ioctl: function() {
      throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
    },
    node_ops: {
      getattr: function(node) {
        IOFS.debug('getattr', arguments);
        return IOFS.profile('getattr', function() {
          var metadata = null;
          if (node.handle) {
            metadata = node.handle.getAttributes();
          } else {
            try {
              var path = IOFS.realPath(node);
              var handle = VFS.root.open(path);
              metadata = handle.getAttributes();
            } catch (e) {
              if (!('code' in e)) throw e;
              throw new FS.ErrnoError(-e.errno);
            } finally {
              if (handle) {
                handle.close();
              }
            }
          }
          return {
            dev: null,
            ino: null,
            mode: node.mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: null,
            size: metadata.size,
            atime: metadata.modificationTime,
            mtime: metadata.modificationTime,
            ctime: metadata.modificationTime,
            blksize: 4096,
            blocks: (metadata.size+4096-1)/4096|0,
          };
        });
      },
      setattr: function(node, attr) {
        IOFS.debug('setattr', arguments);
        if ('size' in attr) {
          //TODO: Update mtime after truncation
          var path = IOFS.realPath(node);
          VFS.root.truncate(path, attr.size)
        } else {
          throw new FS.ErrnoError({{{ cDefine('EPERM') }}});
        }
      },
      lookup: function (parent, name) {
        IOFS.debug('lookup', arguments);
        return IOFS.profile('lookup', function() {
          var path = IOFS.joinPaths(IOFS.realPath(parent), name);
          if (!VFS.root.exists(path)) {
            throw FS.genericErrors[{{{ cDefine('ENOENT') }}}];
          }

          var mode = {{{ cDefine('S_IFREG') }}} | 511 /* 0777 */

          var node = FS.createNode(parent, name, mode);
          node.node_ops = IOFS.node_ops;
          node.stream_ops = IOFS.stream_ops;
          return node;
        });
      },
      mknod: function (parent, name, mode, dev) {
        IOFS.debug('mknod', arguments);
        var node = IOFS.createNode(parent, name, mode, dev);
        try {
          if (FS.isFile(mode)) {
            var path = IOFS.realPath(node);

            // Create non-existing file.
            var fileHandle = VFS.root.open(path);
            fileHandle.close();

            node.handle = null;
            node.refcount = 0;
          }
        } catch (e) {
          if (!('code' in e)) throw e;
          throw new FS.ErrnoError(-e.errno);
        }
        return node;
      },
      rename: function (oldNode, newParentNode, newName) {
        IOFS.debug('rename', arguments);
        if(oldNode.isFolder) {
          // Only file renames are supported for now
          throw new FS.ErrnoError({{{ cDefine('EPERM') }}});
        }

        var oldPath = IOFS.realPath(oldNode);
        var newPath = IOFS.joinPaths(IOFS.realPath(newParentNode), newName);
        try {
          VFS.root.move(oldPath, newPath, oldNode.isFolder)
        } catch (e) {
          if (!('code' in e)) throw e;
          throw new FS.ErrnoError(-e.errno);
        }
      },
      unlink: function(parent, name) {
        IOFS.debug('unlink', arguments);
        IOFS.profile('unlink', function() {
          var path = IOFS.joinPaths(IOFS.realPath(parent), name);
          VFS.root.unlink(path);
        });
      },
      rmdir: function(parent, name) {
        IOFS.debug('rmdir', arguments);
        return MEMFS.rmddir(parent, name);
      },
      readdir: function(node) {
        IOFS.debug('readdir', arguments);
        var parentPath = IOFS.realPath(node);
        // Make sure we only catch the children of the node in case a directory
        // is the prefix of another
        parentPath += parentPath + '_';
        var root = VFS.root.getDirectory('/', null);
        var paths = root.createReader().readEntries().map(fileEntry => fileEntry.name);
        var children = paths.filter(name => name.startsWith(parentPath));
        var res = children.map(child => IOFS.realPathName(child));
        return res;
      },
      symlink: function(parent, newName, oldPath) {
        throw new FS.ErrnoError({{{ cDefine('EPERM') }}});
      },
      readlink: function(node) {
        var path = IOFS.realPath(node);
        try {
          path = fs.readlinkSync(path);
          path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
          return path;
        } catch (e) {
          if (!('code' in e)) throw e;
          throw new FS.ErrnoError(-e.errno);
        }
      },
    },
    stream_ops: {
      open: function (stream) {
        IOFS.debug('open', arguments);
        IOFS.profile('open', function() {
          try {
            if (FS.isFile(stream.node.mode)) {
              if (stream.node.handle) {
                stream.handle = stream.node.handle;
                ++stream.node.refcount;
              } else {
                var path = IOFS.realPath(stream.node);

                // Open existing file.
                stream.handle = VFS.root.open(path);
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
        IOFS.debug('close', arguments);
        IOFS.profile('close', function() {
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
        IOFS.debug('fsync', arguments);
        return 0;
      },
      read: function (stream, buffer, offset, length, position) {
        IOFS.debug('read', arguments);
        return IOFS.profile('read', function() {
          var data = new Uint8Array(stream.handle.read(position, length));
          var bytesRead = data.length;
          buffer.set(data, offset);
          return bytesRead;
        });
      },
      write: function (stream, buffer, offset, length, position) {
        IOFS.debug('write', arguments);
        return IOFS.profile('write', function() {
          var data = buffer.subarray(offset, offset + length);
          return stream.handle.write(data, position);
        });
      },
      llseek: function (stream, offset, whence) {
        IOFS.debug('llseek', arguments);
        return IOFS.profile('llseek', function() {
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
        IOFS.debug('mmap', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },
      msync: function(stream, buffer, offset, length, mmapFlags) {
        IOFS.debug('msync', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },
      munmap: function(stream) {
        IOFS.debug('munmap', arguments);
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      },
    }
  }
});
