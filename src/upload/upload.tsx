/* eslint-disable no-param-reassign */
import { VNode } from 'vue';
import { ScopedSlotReturnValue } from 'vue/types/vnode';
import findIndex from 'lodash/findIndex';
import isFunction from 'lodash/isFunction';
import mixins from '../utils/mixins';
import getLocalReceiverMixins from '../locale/local-receiver';
import { prefix } from '../config';
import Dragger from './dragger';
import ImageCard from './image';
import FlowList from './flow-list';
import xhr from './xhr';
import TIconUpload from '../icon/upload';
import TButton from '../button';
import TDialog from '../dialog';
import SingleFile from './single-file';
import { renderContent } from '../utils/render-tnode';
import props from './props';
import { ClassName } from '../common';
import { emitEvent } from '../utils/event';
import {
  HTMLInputEvent,
  SuccessContext,
  ProgressContext,
  UploadRemoveOptions,
  FlowRemoveContext,
  URL,
} from './interface';
import {
  TdUploadProps, UploadChangeContext, UploadFile, UploadRemoveContext, RequestMethodResponse, SizeUnit, SizeLimitObj,
} from './type';

const name = `${prefix}-upload`;
/**
 * [*] 表示方法采用这种方式
 * [x] 表示方法不采用这种方式
 *
 * [x] bit      位              b     0 or 1
 * [*] byte     字节            B     8 bits
 * [x] kilobit  千位            kb    1000 bites
 * [*] kilobyte 千字节(二进制)   KB    1024 bytes
 * [x] kilobyte 千字节(十进制)   KB    1000 bytes
 * [x] Megabite 百万位          Mb    1000 kilobits
 * [*] Megabyte 兆字节(二进制)   KB    1024 kilobytes
 * [*] Megabyte 兆字节(十进制)   KB    1000 kilobytes
 * [x] Gigabit  万亿位          Gb    1000 Megabite
 * [*] Gigabyte 吉字节(二进制)   GB    1024 Megabytes
 * [x] Gigabyte 吉字节(十进制)   GB    1000 Megabytes
 */

// 各个单位和 KB 的关系
const SIZE_MAP = {
  B: 1024,
  KB: 1,
  MB: 1048576, // 1024 * 1024
  GB: 1073741824, // 1024 * 1024 * 1024
};

/**
 * 大小比较
 * @param size 文件大小
 * @param unit 计算机计量单位
 */
function isOverSizeLimit(fileSize: number, sizeLimit: number, unit: SizeUnit) {
  // 以 KB 为单位进行比较
  const units = ['B', 'KB', 'MB', 'GB'];
  const KBIndex = 1;
  let index = units.indexOf(unit);
  if (index === -1) {
    console.warn(`TDesign Upload Warn: \`sizeLimit.unit\` can only be one of ${units.join()}`);
    index = KBIndex;
  }
  const num = SIZE_MAP[unit];
  const limit = index < KBIndex ? (sizeLimit / num) : (sizeLimit * num);
  return fileSize <= limit;
}

export default mixins(getLocalReceiverMixins('upload')).extend({
  name: 'TUpload',

  components: {
    Dragger,
    SingleFile,
    ImageCard,
    FlowList,
    TDialog,
  },

  model: {
    prop: 'files',
    event: 'change',
  },

  props: { ...props },

  data() {
    return {
      dragActive: false,
      // 加载中的文件
      loadingFile: null as UploadFile,
      // 等待上传的文件队列
      toUploadFiles: [],
      errorMsg: '',
      showImageViewDialog: false,
      showImageViewUrl: '',
      URL: null as URL,
      xhrReq: null as XMLHttpRequest,
    };
  },

  computed: {
    // 默认文件上传风格：文件进行上传和上传成功后不显示 tips
    showTips(): boolean {
      if (this.theme === 'file') {
        const hasNoFile = (!this.files || !this.files.length) && (!this.loadingFile);
        return this.tips && hasNoFile;
      }
      return Boolean(this.tips);
    },
    // 完全自定义上传
    showCustomDisplay(): boolean {
      return this.theme === 'custom';
    },
    // 单文件非拖拽类文件上传
    showSingleDisplay(): boolean {
      return (!this.draggable) && ['file', 'file-input'].includes(this.theme);
    },
    // 单文件非拖拽勒图片上传
    showImgCard(): boolean {
      return !this.draggable && this.theme === 'image';
    },
    // 拖拽类单文件或图片上传
    singleDraggable(): boolean {
      return !this.multiple && this.draggable && ['file', 'file-input', 'image'].includes(this.theme);
    },
    showUploadList(): boolean {
      return this.multiple && ['file-flow', 'image-flow'].includes(this.theme);
    },
    showImgDialog(): boolean {
      return ['image', 'image-flow', 'custom'].includes(this.theme);
    },
    showErrorMsg(): boolean {
      return !this.showUploadList && !!this.errorMsg;
    },
    tipsClasses(): ClassName {
      return [`${name}__tips ${name}__small`];
    },
    errorClasses(): ClassName {
      return this.tipsClasses.concat(`${name}__tips-error`);
    },
  },

  methods: {
    emitChangeEvent(files: Array<UploadFile>, ctx: UploadChangeContext) {
      emitEvent<Parameters<TdUploadProps['onChange']>>(this, 'change', files, ctx);
    },
    emitRemoveEvent(ctx: UploadRemoveContext) {
      emitEvent<Parameters<TdUploadProps['onRemove']>>(this, 'remove', ctx);
    },
    // handle event of preview img dialog event
    handlePreviewImg(event: MouseEvent, file: UploadFile) {
      if (!file.url) throw new Error('Error file');
      this.showImageViewUrl = file.url;
      this.showImageViewDialog = true;
      const previewCtx = { file, e: event };
      emitEvent<Parameters<TdUploadProps['onPreview']>>(this, 'preview', previewCtx);
    },

    handleChange(event: HTMLInputEvent): void {
      const { files } = event.target;
      if (this.disabled) return;
      this.uploadFiles(files);
      (this.$refs.input as HTMLInputElement).value = '';
    },

    handleDragChange(files: FileList): void {
      if (this.disabled) return;
      this.uploadFiles(files);
    },

    handleSingleRemove(e: MouseEvent) {
      const changeCtx = { trigger: 'remove' };
      if (this.loadingFile) this.loadingFile = null;
      this.errorMsg = '';
      this.emitChangeEvent([], changeCtx);
      this.emitRemoveEvent({ e });
    },

    handleMultipleRemove(options: UploadRemoveOptions) {
      const changeCtx = { trigger: 'remove', ...options };
      const files = this.files.concat();
      files.splice(options.index, 1);
      this.emitChangeEvent(files, changeCtx);
      this.emitRemoveEvent(options);
    },

    handleListRemove(context: FlowRemoveContext) {
      const { file } = context;
      const index = findIndex(this.toUploadFiles, (o) => o.name === file.name);
      if (index >= 0) {
        this.toUploadFiles.splice(index, 1);
      } else {
        const index = findIndex(this.files, (o) => o.name === file.name);
        this.handleMultipleRemove({ e: context.e, index });
      }
    },

    uploadFiles(files: FileList) {
      let tmpFiles = [...files];
      if (this.max) {
        tmpFiles = tmpFiles.slice(0, this.max - this.files.length);
        if (tmpFiles.length !== files.length) {
          console.warn(`TDesign Upload Warn: you can only upload ${this.max} files`);
        }
      }
      tmpFiles.forEach((fileRaw: File) => {
        let file: UploadFile | File = fileRaw;
        if (typeof this.format === 'function') {
          file = this.format(fileRaw);
        }
        const uploadFile: UploadFile = {
          raw: fileRaw,
          lastModified: fileRaw.lastModified,
          name: fileRaw.name,
          size: fileRaw.size,
          type: fileRaw.type,
          percent: 0,
          status: 'waiting',
          ...file,
        };
        uploadFile.url = this.getLocalFileURL(fileRaw);
        this.handleBeforeUpload(file).then((canUpload) => {
          if (!canUpload) return;
          const newFiles = this.toUploadFiles.concat();
          newFiles.push(uploadFile);
          this.toUploadFiles = [...new Set(newFiles)];
          this.loadingFile = uploadFile;
          if (this.autoUpload) {
            this.upload(uploadFile);
          }
        });
      });
    },

    async upload(file: UploadFile): Promise<void> {
      if (!this.action && !this.requestMethod) {
        console.error('TDesign Upload Error: one of action and requestMethod must be exist.');
        return;
      }
      this.errorMsg = '';
      file.status = 'progress';
      this.loadingFile = file;
      // requestMethod 为父组件定义的自定义上传方法
      if (this.requestMethod) {
        this.handleRequestMethod(file);
      } else {
        // 模拟进度条
        const timer = setInterval(() => {
          file.percent += 1;
          if (file.percent >= 99) {
            clearInterval(timer);
          }
        }, 10);
        const request = xhr;
        this.xhrReq = request({
          action: this.action,
          data: this.data,
          file,
          name: this.name,
          headers: this.headers,
          withCredentials: this.withCredentials,
          onError: this.onError,
          onProgress: this.handleProgress,
          onSuccess: this.handleSuccess,
        });
      }
    },

    handleRequestMethod(file: UploadFile) {
      if (!isFunction(this.requestMethod)) {
        console.warn('TDesign Upload Warn: `requestMethod` must be a function.');
        return;
      }
      this.requestMethod(file).then((res: RequestMethodResponse) => {
        if (!this.handleRequestMethodResponse(res)) return;
        if (res.status === 'success') {
          this.handleSuccess({ file, response: res.response });
        } else if (res.status === 'fail') {
          const r = res.response || {};
          this.onError({ file, response: { ...r, error: res.error } });
        }
      });
    },

    handleRequestMethodResponse(res: RequestMethodResponse) {
      if (!res) {
        console.error('TDesign Upoad Error: `requestMethodResponse` is required.');
        return false;
      }
      if (!res.status) {
        console.error(
          'TDesign Upoad Error: `requestMethodResponse.status` is missing, which value is `success` or `fail`',
        );
        return false;
      }
      if (!['success', 'fail'].includes(res.status)) {
        console.error('TDesign Upoad Error: `requestMethodResponse.status` must be `success` or `fail`');
        return false;
      }
      if (res.status === 'success' && (!res.response || !res.response.url)) {
        console.warn(
          'TDesign Upoad Warn: `requestMethodResponse.response.url` is required, when `status` is `success`',
        );
      }
      return true;
    },

    multipleUpload(files: Array<UploadFile>) {
      files.forEach((file) => {
        this.upload(file);
      });
    },

    onError(options: { event?: ProgressEvent; file: UploadFile; response?: any }) {
      const { event, file, response } = options;
      file.status = 'fail';
      this.loadingFile = file;
      let res = response;
      if (typeof this.formatResponse === 'function') {
        res = this.formatResponse(response);
      }
      this.errorMsg = res?.error;
      const context = { e: event, file };
      emitEvent<Parameters<TdUploadProps['onFail']>>(this, 'fail', context);
    },

    handleProgress({ event, file, percent }: ProgressContext) {
      file.percent = percent;
      this.loadingFile = file;
      const progressCtx = { percent, e: event, file };
      emitEvent<Parameters<TdUploadProps['onProgress']>>(this, 'progress', progressCtx);
    },

    handleSuccess({ event, file, response }: SuccessContext) {
      file.status = 'success';
      file.url = response.url || file.url;
      // 从待上传文件队列中移除上传成功的文件
      const index = findIndex(this.toUploadFiles, (o) => o.name === file.name);
      this.toUploadFiles.splice(index, 1);
      // 上传成功的文件发送到 files
      const newFile: UploadFile = { ...file, response };
      const files = this.multiple ? this.files.concat(newFile) : [newFile];
      const context = { e: event, response, trigger: 'upload-success' };
      this.emitChangeEvent(files, context);
      const sContext = {
        file, fileList: files, e: event, response,
      };
      emitEvent<Parameters<TdUploadProps['onSuccess']>>(this, 'success', sContext);
      // https://developer.mozilla.org/zh-CN/docs/Web/API/URL/createObjectURL
      this.URL && this.URL.revokeObjectURL(this.loadingFile.url);
      this.loadingFile = null;
    },

    handlePreview({ file, event }: {file: UploadFile; event: ProgressEvent}) {
      return { file, event };
    },

    triggerUpload() {
      if (this.disabled) return;
      (this.$refs.input as HTMLInputElement).click();
    },

    handleDragenter(e: DragEvent) {
      if (this.disabled) return;
      this.dragActive = true;
      emitEvent<Parameters<TdUploadProps['onDragenter']>>(this, 'dragenter', { e });
    },

    handleDragleave(e: DragEvent) {
      if (this.disabled) return;
      this.dragActive = false;
      emitEvent<Parameters<TdUploadProps['onDragleave']>>(this, 'dragleave', { e });
    },

    handleBeforeUpload(file: File | UploadFile): Promise<boolean> {
      if (typeof this.beforeUpload === 'function') {
        const r = this.beforeUpload(file);
        if (r instanceof Promise) return r;
        return new Promise((resolve) => resolve(r));
      }
      return new Promise((resolve) => {
        if (this.sizeLimit) {
          resolve(this.handleSizeLimit(file.size));
        }
        resolve(true);
      });
    },

    handleSizeLimit(fileSize: number) {
      const sizeLimit: SizeLimitObj = typeof this.sizeLimit === 'number'
        ? { size: this.sizeLimit, unit: 'KB' }
        : this.sizeLimit;
      const rSize = isOverSizeLimit(fileSize, sizeLimit.size, sizeLimit.unit);
      if (!rSize) {
        // 有参数 message 则使用，没有就使用全局 locale 配置
        this.errorMsg = sizeLimit.message
          ? this.t(sizeLimit.message, { sizeLimit: sizeLimit.size })
          : `${this.t(this.locale.sizeLimitMessage, { sizeLimit: sizeLimit.size })} ${sizeLimit.unit}`;
      }
      return rSize;
    },

    cancelUpload() {
      if (this.loadingFile) {
        // https://developer.mozilla.org/zh-CN/docs/Web/API/URL/createObjectURL
        this.URL && this.URL.revokeObjectURL(this.loadingFile.url);
        // 如果存在自定义上传方法，则只需要抛出事件，而后由父组件处理取消上传
        if (this.requestMethod) {
          emitEvent<Parameters<TdUploadProps['onCancelUpload']>>(this, 'cancel-upload');
        } else {
          this.xhrReq && this.xhrReq.abort();
        }
        this.loadingFile = null;
      }
      (this.$refs.input as HTMLInputElement).value = '';
    },

    // close image view dialog
    cancelPreviewImgDialog() {
      this.showImageViewDialog = false;
      this.showImageViewUrl = '';
    },

    getDefaultTrigger() {
      if (this.theme === 'file-input' || this.showUploadList) {
        return <TButton variant='outline'>选择文件</TButton>;
      }
      return (
        <TButton variant='outline'>
          <TIconUpload slot='icon'/>点击上传
        </TButton>
      );
    },

    getLocalFileURL(file: File) {
      return this.URL && this.URL.createObjectURL(file);
    },

    renderInput() {
      return (
        <input
          ref='input'
          type='file'
          disabled={this.disabled}
          onChange={this.handleChange}
          multiple={this.multiple}
          accept={this.accept}
          hidden
        />
      );
    },
    // 渲染单文件预览：设计稿有两种单文件预览方式，文本型和输入框型
    renderSingleDisplay(triggerElement: ScopedSlotReturnValue) {
      return (
        <SingleFile
          file={this.files && this.files[0]}
          loadingFile={this.loadingFile}
          display={this.theme}
          remove={this.handleSingleRemove}
          showUploadProgress={this.showUploadProgress}
          placeholder={this.placeholder}
        >
          <div class={`${name}__trigger`} onclick={this.triggerUpload}>{triggerElement}</div>
        </SingleFile>
      );
    },
    renderDraggerTrigger() {
      const params = {
        dragActive: this.dragActive,
        uploadingFile: this.multiple ? this.toUploadFiles : this.loadingFile,
      };
      const triggerElement = renderContent(this, 'default', 'trigger', { params });
      return (
        <Dragger
          showUploadProgress={this.showUploadProgress}
          onChange={this.handleDragChange}
          onDragenter={this.handleDragenter}
          onDragleave={this.handleDragleave}
          loadingFile={this.loadingFile}
          file={this.files && this.files[0]}
          display={this.theme}
          cancel={this.cancelUpload}
          trigger={this.triggerUpload}
          remove={this.handleSingleRemove}
          upload={this.upload}
        >
          {triggerElement}
        </Dragger>
      );
    },
    renderTrigger() {
      const defaultNode = this.getDefaultTrigger();
      return renderContent(this, 'default', 'trigger', defaultNode);
    },
    renderCustom(triggerElement: VNode) {
      return this.draggable
        ? this.renderDraggerTrigger()
        : <div class={`${name}__trigger`} onclick={this.triggerUpload}>{triggerElement}</div>;
    },
  },
  mounted() {
    // webkitURL is for chrome/webkit, while URL is for mozilla/firefox
    window && (this.URL = window.webkitURL || window.URL);
  },

  render(): VNode {
    const triggerElement = this.renderTrigger();
    return (
      <div class={`${name}`}>
        {this.renderInput()}
        {this.showCustomDisplay && this.renderCustom(triggerElement)}
        {this.showSingleDisplay && this.renderSingleDisplay(triggerElement)}
        {this.singleDraggable && this.renderDraggerTrigger()}
        {this.showImgCard && (
          <ImageCard
            files={this.files}
            multiple={this.multiple}
            remove={this.handleMultipleRemove}
            trigger={this.triggerUpload}
            loadingFile={this.loadingFile}
            toUploadFiles={this.toUploadFiles}
            max={this.max}
            onImgPreview={this.handlePreviewImg}
          ></ImageCard>
        )}
        {this.showUploadList && (
          <FlowList
            files={this.files}
            placeholder={this.placeholder}
            autoUpload={this.autoUpload}
            toUploadFiles={this.toUploadFiles}
            remove={this.handleListRemove}
            showUploadProgress={this.showUploadProgress}
            upload={this.multipleUpload}
            cancel={this.cancelUpload}
            display={this.theme}
            onImgPreview={this.handlePreviewImg}
            onChange={this.handleDragChange}
            onDragenter={this.handleDragenter}
            onDragleave={this.handleDragleave}
          >
            <div class={`${name}__trigger`} onclick={this.triggerUpload}>{triggerElement}</div>
          </FlowList>
        )}
        {this.showImgDialog && (
          <TDialog
            visible={this.showImageViewDialog}
            showOverlay
            width='auto'
            top='10%'
            class={`${name}-dialog`}
            footer={false}
            header={false}
            onClose={this.cancelPreviewImgDialog}>
              <p class={`${prefix}-dialog__body-img-box`}>
                <img class='' src={this.showImageViewUrl} alt='' />
              </p>
          </TDialog>
        )}
        {!this.errorMsg && this.showTips && <small class={this.tipsClasses}>{this.tips}</small>}
        {this.showErrorMsg && <small class={this.errorClasses}>{this.errorMsg}</small>}
      </div>
    );
  },
});
