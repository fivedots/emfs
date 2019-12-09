// Copyright 2019 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

mergeInto(LibraryManager.library, {
  $CHROMEFS__deps: ['$ERRNO_CODES', '$FS'],
  $CHROMEFS__postset: '' +
      'if (typeof webkitRequestFileSystemSync !== "undefined") {' +
      'var VFS = webkitRequestFileSystemSync(PERSISTENT, 1024*1024*10);' +
      'console.log("VFS", VFS);' +
      '}',
  $CHROMEFS: {

    /* Debugging */

    debug: function(...args) {
      // Uncomment to print debug information.
      //
      // console.log('chromefs', arguments);
    },

    /* Profiling */

    profileData: {},

    profileMetric: function(name, value) {
      if (name in CHROMEFS.profileData) {
        CHROMEFS.profileData[name].value += value;
        CHROMEFS.profileData[name].count++;
      } else {
        CHROMEFS.profileData[name] = {
          value: value,
          count: 1,
        }
      }
    },

    profile : function(name, fn) {
      var start = performance.now();
      var result = fn();
      var value = performance.now() - start;
      CHROMEFS.profileMetric(name, value);
      return result;
    },

    /* Filesystem implementation (public interface) */

    createNode: function (parent, name, mode, dev) {
      CHROMEFS.debug('createNode', arguments);
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError({{{ cDefine('EINVAL') }}});
      }
      var node = FS.createNode(parent, name, mode);
      node.node_ops = CHROMEFS.node_ops;
      node.stream_ops = CHROMEFS.stream_ops;
      return node;
    },

    mount: function (mount) {
      CHROMEFS.debug('mount', arguments);
      var node = CHROMEFS.createNode(null, '/', {{{ cDefine('S_IFDIR') }}} | 511 /* 0777 */, 0);
      node.localReference = VFS.root;
      return node;
    },

    cwd: function() { return process.cwd(); },

    chdir: function() { process.chdir.apply(void 0, arguments); },

    allocate: function() {
      throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
    },

    ioctl: function() {
      throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
    },

    /* Operations on the nodes of the filesystem tree */

    node_ops: {
      getattr: function(node) {
        CHROMEFS.debug('getattr', arguments);
        return CHROMEFS.profile('getattr', function() {
          var metadata = null;
          try {
            metadata = node.localReference.getMetadata();
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
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
        CHROMEFS.debug('setattr', arguments);
        CHROMEFS.profile('setattr', function() {
          if ('size' in attr) {
            data = new ArrayBuffer(attr.size);
            var blob = new Blob([data]);
            var writer = node.localReference.createWriter();
            writer.write(blob);
          } else {
            throw new FS.ErrnoError({{{ cDefine('EPERM') }}});
          }
        });
      },

      lookup: function (parent, name) {
        CHROMEFS.debug('lookup', arguments);
        return CHROMEFS.profile('lookup', function() {
          var childLocalReference = null;
          var mode = null;
          try {
            childLocalReference = parent.localReference.getDirectory(name, {create: false});
            mode = {{{ cDefine('S_IFDIR') }}} | 511 /* 0777 */
          } catch (e) {
            try {
              childLocalReference = parent.localReference.getFile(name, {create: false});
              mode = {{{ cDefine('S_IFREG') }}} | 511 /* 0777 */
            } catch (e) {
              throw FS.genericErrors[{{{ cDefine('ENOENT') }}}];
            }
          }
          var node = FS.createNode(parent, name, mode);
          node.node_ops = CHROMEFS.node_ops;
          node.stream_ops = CHROMEFS.stream_ops;
          node.localReference = childLocalReference;
          return node;
        });
      },

      mknod: function (parent, name, mode, dev) {
        CHROMEFS.debug('mknod', arguments);
        return CHROMEFS.profile('mknod', function() {
          var node = CHROMEFS.createNode(parent, name, mode, dev);
          try {
            if (FS.isDir(mode)) {
              node.localReference = parent.localReference.getDirectory(name, {create: true});
            } else if (FS.isFile(mode)) {
              node.localReference = parent.localReference.getFile(name, {create: true});
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(e.errno);
          }
          return node;
        });
      },

      rename: function (oldNode, newParentNode, newName) {
        CHROMEFS.debug('rename', arguments);
        CHROMEFS.profile('rename', function() {
          try {
            oldNode.localReference.moveTo(newParentNode.localReference, newName);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        });
      },

      unlink: function(parent, name) {
        CHROMEFS.debug('unlink', arguments);
        CHROMEFS.profile('unlink', function() {
          var childLocalReference = null;
          try {
            childLocalReference = parent.localReference.getDirectory(name, {create: false});
          } catch (e) {
            try {
              childLocalReference = parent.localReference.getFile(name, {create: false});
            } catch (e) {
              throw FS.genericErrors[{{{ cDefine('ENOENT') }}}];
            }
          }
          childLocalReference.remove();
        });
      },

      rmdir: function(parent, name) {
        CHROMEFS.debug('rmdir', arguments);
        CHROMEFS.profile('rmdir', function() {
          var childLocalReference = null;
          try {
            childLocalReference = parent.localReference.getDirectory(name, {create: false});
          } catch (e) {
            throw FS.genericErrors[{{{ cDefine('ENOENT') }}}];
          }
          childLocalReference.remove();
        });
      },

      readdir: function(node) {
        CHROMEFS.debug('readdir', arguments);
        return CHROMEFS.profile('readdir', function() {
          try {
            var entries = node.localReference.createReader().readEntries();
            return entries.map(entry => entry.name);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
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
        CHROMEFS.debug('open', arguments);
        CHROMEFS.profile('open', function() {
          try {
            if (FS.isFile(stream.node.mode)) {
              // TODO(jabolopes): Check file mode before opening reader / writer.
              stream.readHandle = stream.node.localReference.file();
              stream.writeHandle = stream.node.localReference.createWriter();
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(e.errno);
          }
        });
      },

      close: function (stream) {
        CHROMEFS.debug('close', arguments);
        CHROMEFS.profile('close', function() {
          try {
            if (FS.isFile(stream.node.mode)) {
              if (stream.readHandle) {
                stream.readHandle = null;
              }
              if (stream.writeHandle) {
                stream.writeHandle = null;
              }
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(-e.errno);
          }
        });
      },

      fsync: function(stream) {
        CHROMEFS.debug('fsync', arguments);
        return CHROMEFS.profile('fsync', function() {
          return 0;
        });
      },

      read: function (stream, buffer, offset, length, position) {
        CHROMEFS.debug('read', arguments);
        return CHROMEFS.profile('read', function() {
          var file = stream.readHandle;
          var start = performance.now();
          var blob = file.slice(position, position + length);
          CHROMEFS.profileMetric('read.slice', performance.now() - start);
          var reader = new FileReaderSync();
          return CHROMEFS.profile('read.readAsArrayBuffer', function() {
            var data = new Uint8Array(reader.readAsArrayBuffer(blob));
            var bytesRead = data.length;
            buffer.set(data, offset);
            return bytesRead;
          });
        });
      },

      write: function (stream, buffer, offset, length, position) {
        CHROMEFS.debug('write', arguments);
        return CHROMEFS.profile('write', function() {
          var writer = stream.writeHandle;
          writer.seek(position);
          var data = buffer.subarray(offset, offset + length);
          var blob = new Blob([data]);
          var bytesWritten = blob.size;
          writer.write(blob);
          return bytesWritten;
        });
      },

      llseek: function (stream, offset, whence) {
        CHROMEFS.debug('llseek', arguments);
        return CHROMEFS.profile('llseek', function() {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            position += stream.node.localReference.getMetadata().size;
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
        CHROMEFS.debug('mmap', arguments);

        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError({{{ cDefine('ENODEV') }}});
        }
        var ptr = _malloc(length);

        if (!ptr) {
          throw new FS.ErrnoError({{{ cDefine('ENOMEM') }}});
        }
        // TODO(jabolopes): Handle return value?
        stream.stream_ops.read(stream, buffer, ptr, length, position);

        return { ptr: ptr, allocated: true };
      },

      msync: function(stream, buffer, offset, length, mmapFlags) {
        CHROMEFS.debug('msync', arguments);

        // TODO(jabolopes): Handle return value?
        stream.stream_ops.write(stream, buffer, 0, length, offset);

        return 0;
      },

      munmap: function(stream) {
        CHROMEFS.debug('munmap', arguments);
        return 0;
      },
    }
  }
});
